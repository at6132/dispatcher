import type { VehicleClass } from '../auth/types';
import { apiFetch } from './client';

export type DriveStatus = 'open' | 'assigned' | 'completed' | 'cancelled';

export type TripType = 'one_way' | 'round_trip';

export type PublicProfile = {
  id: string;
  name: string;
  onboardingComplete: boolean;
  onboarding?: {
    vehicleClass: VehicleClass;
    vehicleType: string;
    seats: number;
    selfPhotoUri?: string;
    vehicleInteriorUri?: string;
    vehicleExteriorUri?: string;
    yearsDrivingUpstate: number;
    extraInfo?: string;
  };
};

export type Drive = {
  id: string;
  posterId: string;
  routeText: string;
  fromPlace?: string;
  toPlace?: string;
  status: DriveStatus;
  assigneeId?: string;
  passengerPhone?: string;
  address?: string;
  vehicleClass?: VehicleClass;
  seats?: number;
  tripType?: TripType;
  extraInfo?: string;
  costCents?: number;
  miles?: string;
  waitMinutes?: number;
  completeNote?: string;
  hiddenByPoster: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type CreateDriveInput = {
  routeText: string;
  passengerPhone: string;
  vehicleClass: VehicleClass;
  seats: number;
  tripType: TripType;
  address?: string;
  extraInfo?: string;
};

export type DriveListItem = Drive & {
  poster: PublicProfile;
  assignee?: PublicProfile;
};

/** Home board sections → list query. */
export type DriveBoard = 'open' | 'active' | 'history';

export type ListDrivesResult = {
  items: DriveListItem[];
  nextCursor?: string;
};

function boardQuery(board: DriveBoard): string {
  switch (board) {
    case 'open':
      return 'status=open';
    case 'active':
      return 'status=active';
    case 'history':
      return 'status=history';
  }
}

function asListItem(raw: Drive & { poster?: PublicProfile; assignee?: PublicProfile }): DriveListItem {
  return {
    ...raw,
    poster: raw.poster ?? {
      id: raw.posterId,
      name: 'Driver',
      onboardingComplete: false,
    },
    ...(raw.assignee ? { assignee: raw.assignee } : {}),
  };
}

export async function listDrives(
  board: DriveBoard,
  opts?: { limit?: number; cursor?: string },
): Promise<ListDrivesResult> {
  const params = new URLSearchParams(boardQuery(board));
  if (opts?.limit != null) params.set('limit', String(opts.limit));
  if (opts?.cursor) params.set('cursor', opts.cursor);
  const data = await apiFetch<ListDrivesResult>(`/v1/drives?${params.toString()}`);
  return {
    items: (data.items ?? []).map(asListItem),
    ...(data.nextCursor ? { nextCursor: data.nextCursor } : {}),
  };
}

export async function getDrive(id: string): Promise<Drive> {
  const data = await apiFetch<{ drive: Drive }>(`/v1/drives/${id}`);
  return data.drive;
}

export async function getPublicProfile(id: string): Promise<PublicProfile> {
  const data = await apiFetch<{ user: PublicProfile }>(`/v1/profiles/${id}`);
  return data.user;
}

export async function createDrive(input: CreateDriveInput): Promise<Drive> {
  const data = await apiFetch<{ drive: Drive }>('/v1/drives', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.drive;
}

export async function applyToDrive(
  driveId: string,
  coords?: { lat?: number; lng?: number },
): Promise<{ id: string; driveId: string; status: string; createdAt: string }> {
  const data = await apiFetch<{
    application: {
      id: string;
      driveId: string;
      status: string;
      createdAt: string;
    };
  }>(`/v1/drives/${driveId}/applications`, {
    method: 'POST',
    body: JSON.stringify(coords ?? {}),
  });
  return data.application;
}

export async function completeDrive(
  driveId: string,
  input: {
    costCents: number;
    miles?: number;
    waitMinutes?: number;
    note?: string;
  },
): Promise<{ drive: Drive; balanceId: string }> {
  return apiFetch<{ drive: Drive; balanceId: string }>(
    `/v1/drives/${driveId}/complete`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}
