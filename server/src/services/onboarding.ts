import { and, eq, isNotNull } from 'drizzle-orm';

import { db } from '../db/client.js';
import { driverProfiles, photoUploads, users } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import {
  buildObjectKey,
  extForContentType,
  headObject,
  isAllowedContentType,
  maxPhotoBytes,
  presignPut,
} from '../lib/s3.js';
import { env } from '../config/env.js';
import { toAuthUser, type AuthUserDto } from './auth.js';

const vehicleClasses = [
  'sedan',
  'suv',
  'large_suv',
  'minivan',
  'sprinter',
] as const;

export type OnboardingInput = {
  vehicleClass: (typeof vehicleClasses)[number];
  vehicleType: string;
  seats: number;
  yearsDrivingUpstate: number;
  extraInfo?: string;
  zelle?: string;
  selfPhotoKey?: string;
  vehicleInteriorKey?: string;
  vehicleExteriorKey?: string;
};

async function assertOwnedConfirmedKey(
  userId: string,
  key: string | undefined,
  kind: 'self' | 'interior' | 'exterior',
): Promise<string | undefined> {
  if (!key) return undefined;
  if (key.startsWith('http://') || key.startsWith('https://') || key.includes('..')) {
    throw new AppError(400, 'Invalid photo key', 'invalid_photo_key');
  }
  const prefix = `users/${userId}/`;
  if (!key.startsWith(prefix)) {
    throw new AppError(400, 'Invalid photo key', 'invalid_photo_key');
  }

  const [row] = await db
    .select()
    .from(photoUploads)
    .where(
      and(
        eq(photoUploads.userId, userId),
        eq(photoUploads.objectKey, key),
        eq(photoUploads.kind, kind),
        isNotNull(photoUploads.confirmedAt),
      ),
    )
    .limit(1);
  if (!row) {
    throw new AppError(
      400,
      'Photo must be uploaded and confirmed first',
      'photo_not_confirmed',
    );
  }
  return key;
}

export async function saveOnboarding(
  userId: string,
  input: OnboardingInput,
): Promise<AuthUserDto> {
  if (!vehicleClasses.includes(input.vehicleClass)) {
    throw new AppError(400, 'Choose a vehicle class', 'invalid_vehicle_class');
  }
  const vehicleType = input.vehicleType.trim();
  if (vehicleType.length < 2 || vehicleType.length > 60) {
    throw new AppError(400, 'Enter a valid vehicle type', 'invalid_vehicle_type');
  }
  if (!Number.isInteger(input.seats) || input.seats < 1 || input.seats > 20) {
    throw new AppError(400, 'Enter a valid seat count', 'invalid_seats');
  }
  if (
    !Number.isFinite(input.yearsDrivingUpstate) ||
    input.yearsDrivingUpstate < 0 ||
    input.yearsDrivingUpstate > 80
  ) {
    throw new AppError(400, 'Enter valid years driving', 'invalid_years');
  }
  const zelle = input.zelle?.trim() || undefined;
  if (zelle && (zelle.length < 5 || zelle.length > 120)) {
    throw new AppError(400, 'Enter a valid Zelle email or phone', 'invalid_zelle');
  }
  const extraInfo = input.extraInfo?.trim() || undefined;

  const [selfPhotoKey, vehicleInteriorKey, vehicleExteriorKey] = await Promise.all([
    assertOwnedConfirmedKey(userId, input.selfPhotoKey, 'self'),
    assertOwnedConfirmedKey(userId, input.vehicleInteriorKey, 'interior'),
    assertOwnedConfirmedKey(userId, input.vehicleExteriorKey, 'exterior'),
  ]);

  // Profile + gate flip in one transaction so a successful PUT always means complete.
  await db.transaction(async (tx) => {
    await tx
      .insert(driverProfiles)
      .values({
        userId,
        vehicleClass: input.vehicleClass,
        vehicleType,
        seats: input.seats,
        yearsDrivingUpstate: Math.floor(input.yearsDrivingUpstate),
        zelle,
        extraInfo,
        selfPhotoKey,
        vehicleInteriorKey,
        vehicleExteriorKey,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: driverProfiles.userId,
        set: {
          vehicleClass: input.vehicleClass,
          vehicleType,
          seats: input.seats,
          yearsDrivingUpstate: Math.floor(input.yearsDrivingUpstate),
          zelle,
          extraInfo,
          selfPhotoKey,
          vehicleInteriorKey,
          vehicleExteriorKey,
          updatedAt: new Date(),
        },
      });

    await tx
      .update(users)
      .set({ onboardingComplete: true, updatedAt: new Date() })
      .where(eq(users.id, userId));
  });

  const dto = await toAuthUser(userId);
  // Belt-and-suspenders: never return a successful save as incomplete.
  if (!dto.onboardingComplete) {
    dto.onboardingComplete = true;
  }
  return dto;
}

export async function createPhotoPresign(
  userId: string,
  input: { kind: 'self' | 'interior' | 'exterior'; contentType: string },
) {
  if (!env.s3Enabled) {
    throw new AppError(503, 'Photo storage is not configured', 's3_disabled');
  }
  if (!isAllowedContentType(input.contentType)) {
    throw new AppError(400, 'Unsupported image type', 'invalid_content_type');
  }
  const ext = extForContentType(input.contentType);
  const objectKey = buildObjectKey(userId, input.kind, ext);
  const [row] = await db
    .insert(photoUploads)
    .values({
      userId,
      kind: input.kind,
      objectKey,
      contentType: input.contentType.toLowerCase(),
    })
    .returning();
  if (!row) throw new AppError(500, 'Could not create upload', 'upload_create_failed');
  const { uploadUrl, expiresIn } = await presignPut({
    key: objectKey,
    contentType: input.contentType.toLowerCase(),
  });
  return {
    uploadId: row.id,
    objectKey,
    uploadUrl,
    expiresIn,
    maxBytes: maxPhotoBytes(),
  };
}

export async function confirmPhoto(
  userId: string,
  input: { uploadId: string },
): Promise<{ objectKey: string; kind: 'self' | 'interior' | 'exterior' }> {
  const [row] = await db
    .select()
    .from(photoUploads)
    .where(eq(photoUploads.id, input.uploadId))
    .limit(1);
  if (!row || row.userId !== userId) {
    throw new AppError(404, 'Upload not found', 'upload_not_found');
  }
  if (!env.s3Enabled) {
    throw new AppError(503, 'Photo storage is not configured', 's3_disabled');
  }

  const meta = await headObject(row.objectKey);
  if (!meta.exists) {
    throw new AppError(400, 'Upload not found in storage', 'upload_missing');
  }
  if (meta.contentLength != null && meta.contentLength > maxPhotoBytes()) {
    throw new AppError(400, 'Photo is too large', 'upload_too_large');
  }
  if (meta.contentLength != null && meta.contentLength <= 0) {
    throw new AppError(400, 'Photo is empty', 'upload_empty');
  }
  if (meta.contentType && !isAllowedContentType(meta.contentType.split(';')[0]!.trim())) {
    throw new AppError(400, 'Unsupported image type', 'invalid_content_type');
  }

  await db
    .update(photoUploads)
    .set({ confirmedAt: new Date() })
    .where(eq(photoUploads.id, row.id));
  return { objectKey: row.objectKey, kind: row.kind };
}
