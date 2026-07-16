import { apiFetch, ApiError } from './client';
import {
  listDrives,
  type DriverAvailability,
  type PublicProfile,
} from './drives';

export type ProfileListItem = PublicProfile & {
  favorited: boolean;
};

/** Payload to open compose in direct-send mode. */
export type DirectSendTarget = {
  id: string;
  name: string;
  availability?: DriverAvailability;
  vehicleType?: string;
  photoUri?: string;
  vehicleInteriorUri?: string;
  vehicleExteriorUri?: string;
  detail?: string;
  lastLat?: number;
  lastLng?: number;
};

function asListItem(profile: PublicProfile): ProfileListItem {
  return {
    ...profile,
    favorited: Boolean(
      (profile as ProfileListItem).favorited,
    ),
  };
}

/** Collect drivers seen on the board when /v1/profiles isn’t available. */
async function harvestProfilesFromBoard(
  viewerId?: string,
): Promise<ProfileListItem[]> {
  const boards = ['open', 'active', 'history'] as const;
  const byId = new Map<string, ProfileListItem>();
  await Promise.all(
    boards.map(async (board) => {
      try {
        const { items } = await listDrives(board, { limit: 50 });
        for (const drive of items) {
          if (drive.poster?.id && drive.poster.id !== viewerId) {
            byId.set(drive.poster.id, asListItem(drive.poster));
          }
          if (drive.assignee?.id && drive.assignee.id !== viewerId) {
            byId.set(drive.assignee.id, asListItem(drive.assignee));
          }
        }
      } catch {
        // Board harvest is best-effort
      }
    }),
  );
  return [...byId.values()];
}

/**
 * Full driver directory. Falls back to board faces when the profiles
 * list route isn’t deployed yet (older production builds).
 */
export async function listProfiles(opts?: {
  viewerId?: string;
}): Promise<{ items: ProfileListItem[]; fromBoardFallback: boolean }> {
  try {
    const data = await apiFetch<{ items: ProfileListItem[] }>('/v1/profiles');
    return {
      items: (data.items ?? []).map((item) => ({
        ...item,
        favorited: Boolean(item.favorited),
      })),
      fromBoardFallback: false,
    };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      const harvested = await harvestProfilesFromBoard(opts?.viewerId);
      return { items: harvested, fromBoardFallback: true };
    }
    throw err;
  }
}

export async function getProfile(userId: string): Promise<ProfileListItem> {
  const data = await apiFetch<{ user: ProfileListItem }>(
    `/v1/profiles/${userId}`,
  );
  return {
    ...data.user,
    favorited: Boolean(data.user.favorited),
  };
}

/**
 * Persist a favorite on the server when possible.
 * Returns `local` if the API doesn’t support favorites yet (caller keeps local store).
 */
export async function favoriteProfile(
  userId: string,
): Promise<'server' | 'local'> {
  try {
    await apiFetch<void>(`/v1/profiles/${userId}/favorite`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    return 'server';
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return 'local';
    }
    throw err;
  }
}

export async function unfavoriteProfile(
  userId: string,
): Promise<'server' | 'local'> {
  try {
    await apiFetch<void>(`/v1/profiles/${userId}/favorite`, {
      method: 'DELETE',
    });
    return 'server';
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return 'local';
    }
    throw err;
  }
}

export type PresenceUpdate = {
  availability?: DriverAvailability;
  lat?: number;
  lng?: number;
};

/** Public completed trips on a driver's profile. */
export type ProfileTripHistoryItem = {
  id: string;
  routeText: string;
  tripType: 'one_way' | 'round_trip';
  costCents?: number;
  completedAt?: string;
  createdAt: string;
};

export async function listProfileHistory(
  userId: string,
  opts?: { limit?: number; cursor?: string },
): Promise<{ items: ProfileTripHistoryItem[]; nextCursor?: string }> {
  const params = new URLSearchParams();
  if (opts?.limit != null) params.set('limit', String(opts.limit));
  if (opts?.cursor) params.set('cursor', opts.cursor);
  const qs = params.toString();
  return apiFetch<{ items: ProfileTripHistoryItem[]; nextCursor?: string }>(
    `/v1/profiles/${userId}/history${qs ? `?${qs}` : ''}`,
  );
}

export async function updatePresence(
  input: PresenceUpdate,
): Promise<PublicProfile & { phone?: string; availability: DriverAvailability }> {
  const data = await apiFetch<{
    user: PublicProfile & {
      phone?: string;
      availability: DriverAvailability;
    };
  }>('/v1/me/presence', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
  return data.user;
}
