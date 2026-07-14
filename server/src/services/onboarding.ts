import { eq } from 'drizzle-orm';

import { db } from '../db/client.js';
import { driverProfiles, photoUploads, users } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import {
  buildObjectKey,
  extForContentType,
  isAllowedContentType,
  objectExists,
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

  await db
    .insert(driverProfiles)
    .values({
      userId,
      vehicleClass: input.vehicleClass,
      vehicleType,
      seats: input.seats,
      yearsDrivingUpstate: Math.floor(input.yearsDrivingUpstate),
      zelle,
      extraInfo,
      selfPhotoKey: input.selfPhotoKey,
      vehicleInteriorKey: input.vehicleInteriorKey,
      vehicleExteriorKey: input.vehicleExteriorKey,
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
        selfPhotoKey: input.selfPhotoKey,
        vehicleInteriorKey: input.vehicleInteriorKey,
        vehicleExteriorKey: input.vehicleExteriorKey,
        updatedAt: new Date(),
      },
    });

  await db
    .update(users)
    .set({ onboardingComplete: true, updatedAt: new Date() })
    .where(eq(users.id, userId));

  return toAuthUser(userId);
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
    maxBytes: 5 * 1024 * 1024,
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
  const exists = await objectExists(row.objectKey);
  if (!exists) {
    throw new AppError(400, 'Upload not found in storage', 'upload_missing');
  }
  await db
    .update(photoUploads)
    .set({ confirmedAt: new Date() })
    .where(eq(photoUploads.id, row.id));
  return { objectKey: row.objectKey, kind: row.kind };
}
