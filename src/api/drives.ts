import type { VehicleClass } from '../auth/types';
import { apiFetch, ApiError } from './client';

export type DriveStatus =
  | 'open'
  | 'assigned'
  | 'picked_up'
  | 'completed'
  | 'cancelled';

export type TripType = 'one_way' | 'round_trip';

export type DriverAvailability = 'available' | 'busy' | 'offline';

export type PublicProfile = {
  id: string;
  name: string;
  onboardingComplete: boolean;
  completedDrivesCount?: number;
  /** True when the viewer has favorited this user. */
  isFavorite?: boolean;
  availability?: DriverAvailability;
  lastLat?: number;
  lastLng?: number;
  locationUpdatedAt?: string;
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

export type ApplicationStatus = 'pending' | 'accepted' | 'rejected' | 'cleared';

export type Drive = {
  id: string;
  posterId: string;
  routeText: string;
  fromPlace?: string;
  toPlace?: string;
  status: DriveStatus;
  assigneeId?: string;
  /** Direct offer target — private until accept/decline. */
  invitedDriverId?: string;
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
  /** When set, assignee requested cancel — poster must approve/deny. */
  cancelRequestedAt?: string;
  viewerApplicationStatus?: ApplicationStatus;
  /** True when the viewer favorited the poster. */
  posterIsFavorite?: boolean;
};

export type CreateDriveInput = {
  routeText: string;
  passengerPhone: string;
  vehicleClass: VehicleClass;
  seats: number;
  tripType: TripType;
  address?: string;
  extraInfo?: string;
  /** Offer directly to this driver (they accept/decline). */
  inviteDriverId?: string;
};

export type DriveListItem = Drive & {
  poster: PublicProfile;
  assignee?: PublicProfile;
  /** Current available-driver location, or their accepted apply-time fix. */
  assigneeLat?: number;
  assigneeLng?: number;
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
      completedDrivesCount: 0,
      availability: 'offline',
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

/**
 * Direct jobs offered to the current user.
 * Filters strictly — older APIs may ignore `status=offers` and return the
 * open board, which must never trigger the IncomingJobModal.
 */
export async function listDirectOffers(opts: {
  viewerId: string;
  limit?: number;
}): Promise<DriveListItem[]> {
  const params = new URLSearchParams('status=offers');
  if (opts.limit != null) params.set('limit', String(opts.limit));
  const data = await apiFetch<ListDrivesResult>(
    `/v1/drives?${params.toString()}`,
  );
  return (data.items ?? [])
    .map(asListItem)
    .filter(
      (d) =>
        d.status === 'open' &&
        d.invitedDriverId != null &&
        d.invitedDriverId === opts.viewerId,
    );
}

function inviteRouteMissing(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    err.status === 404 &&
    (err.code === 'not_found' || !err.code || err.code === 'Not found')
  );
}

export async function acceptDirectInvite(driveId: string): Promise<Drive> {
  try {
    const data = await apiFetch<{ drive: Drive }>(
      `/v1/drives/${driveId}/accept-invite`,
      { method: 'POST', body: JSON.stringify({}) },
    );
    return data.drive;
  } catch (err) {
    if (inviteRouteMissing(err)) {
      throw new ApiError(
        'Accept isn’t available on this server yet. The API needs a redeploy with invite routes.',
        404,
        'invite_routes_missing',
      );
    }
    throw err;
  }
}

export async function declineDirectInvite(driveId: string): Promise<Drive> {
  try {
    const data = await apiFetch<{ drive: Drive }>(
      `/v1/drives/${driveId}/decline-invite`,
      { method: 'POST', body: JSON.stringify({}) },
    );
    return data.drive;
  } catch (err) {
    if (inviteRouteMissing(err)) {
      throw new ApiError(
        'Decline isn’t available on this server yet. The API needs a redeploy with invite routes.',
        404,
        'invite_routes_missing',
      );
    }
    throw err;
  }
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

export async function updateDrive(
  driveId: string,
  input: CreateDriveInput,
): Promise<Drive> {
  const data = await apiFetch<{ drive: Drive }>(`/v1/drives/${driveId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
  return data.drive;
}

export type DriveApplication = {
  id: string;
  status: ApplicationStatus;
  lat?: number;
  lng?: number;
  createdAt: string;
  /** True when the poster favorited this applicant. */
  isFavorite?: boolean;
  favorited?: boolean;
  /** Applicant is still finishing another ride (picked_up) — applied mid-job. */
  midJob?: boolean;
  driver: PublicProfile & { phone?: string };
};

export async function listApplications(
  driveId: string,
): Promise<DriveApplication[]> {
  const data = await apiFetch<{ items: DriveApplication[] }>(
    `/v1/drives/${driveId}/applications`,
  );
  return data.items ?? [];
}

export async function clearApplications(
  driveId: string,
): Promise<{ cleared: number }> {
  return apiFetch<{ cleared: number }>(
    `/v1/drives/${driveId}/applications/clear`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}

export async function acceptApplication(
  driveId: string,
  applicationId: string,
): Promise<Drive> {
  const data = await apiFetch<{ drive: Drive }>(`/v1/drives/${driveId}/accept`, {
    method: 'POST',
    body: JSON.stringify({ applicationId }),
  });
  return data.drive;
}

export async function markDrivePickedUp(driveId: string): Promise<Drive> {
  const data = await apiFetch<{ drive: Drive }>(
    `/v1/drives/${driveId}/picked-up`,
    { method: 'POST', body: JSON.stringify({}) },
  );
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

/** Poster takes down a job they posted (leaves the board). */
export async function cancelDrive(driveId: string): Promise<Drive> {
  const data = await apiFetch<{ drive: Drive }>(
    `/v1/drives/${driveId}/cancel`,
    { method: 'POST', body: JSON.stringify({}) },
  );
  return data.drive;
}

/** Assignee requests cancel — poster must approve. */
export async function requestDriveCancel(driveId: string): Promise<Drive> {
  const data = await apiFetch<{ drive: Drive }>(
    `/v1/drives/${driveId}/cancel-request`,
    { method: 'POST', body: JSON.stringify({}) },
  );
  return data.drive;
}

/** Poster approves or denies a pending cancel request. */
export async function respondDriveCancel(
  driveId: string,
  approve: boolean,
): Promise<Drive> {
  const data = await apiFetch<{ drive: Drive }>(
    `/v1/drives/${driveId}/cancel-respond`,
    {
      method: 'POST',
      body: JSON.stringify({ approve }),
    },
  );
  return data.drive;
}
