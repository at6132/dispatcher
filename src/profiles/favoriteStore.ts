import AsyncStorage from '@react-native-async-storage/async-storage';

import type { ProfileListItem } from '../api/profiles';

const FAVORITES_KEY = 'dispatcher.favorites.v1';
const DIRECTORY_KEY = 'dispatcher.profileDirectory.v1';

type FavoritesPayload = {
  /** Viewer user id → set of favorited driver ids */
  byViewer: Record<string, string[]>;
};

type DirectoryPayload = {
  /** Profile id → last known public profile snapshot */
  byId: Record<string, ProfileListItem>;
};

async function readFavorites(): Promise<FavoritesPayload> {
  try {
    const raw = await AsyncStorage.getItem(FAVORITES_KEY);
    if (!raw) return { byViewer: {} };
    const parsed = JSON.parse(raw) as FavoritesPayload;
    return parsed?.byViewer ? parsed : { byViewer: {} };
  } catch {
    return { byViewer: {} };
  }
}

async function writeFavorites(payload: FavoritesPayload): Promise<void> {
  await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(payload));
}

async function readDirectory(): Promise<DirectoryPayload> {
  try {
    const raw = await AsyncStorage.getItem(DIRECTORY_KEY);
    if (!raw) return { byId: {} };
    const parsed = JSON.parse(raw) as DirectoryPayload;
    return parsed?.byId ? parsed : { byId: {} };
  } catch {
    return { byId: {} };
  }
}

async function writeDirectory(payload: DirectoryPayload): Promise<void> {
  await AsyncStorage.setItem(DIRECTORY_KEY, JSON.stringify(payload));
}

export async function getLocalFavoriteIds(viewerId: string): Promise<Set<string>> {
  const store = await readFavorites();
  return new Set(store.byViewer[viewerId] ?? []);
}

export async function setLocalFavorite(
  viewerId: string,
  favoriteUserId: string,
  favorited: boolean,
): Promise<void> {
  const store = await readFavorites();
  const current = new Set(store.byViewer[viewerId] ?? []);
  if (favorited) current.add(favoriteUserId);
  else current.delete(favoriteUserId);
  store.byViewer[viewerId] = [...current];
  await writeFavorites(store);
}

/** Cache profile snapshots so Favorites / All can show after server failures. */
export async function rememberProfiles(
  profiles: ProfileListItem[],
): Promise<void> {
  if (profiles.length === 0) return;
  const dir = await readDirectory();
  for (const profile of profiles) {
    dir.byId[profile.id] = {
      ...dir.byId[profile.id],
      ...profile,
    };
  }
  await writeDirectory(dir);
}

export async function getRememberedProfiles(): Promise<ProfileListItem[]> {
  const dir = await readDirectory();
  return Object.values(dir.byId);
}

/**
 * Merge server list with local favorites + remembered directory.
 * Local favorites win when the server doesn’t know about favoriting yet.
 */
export async function mergeProfilesWithLocal(
  viewerId: string,
  serverItems: ProfileListItem[],
): Promise<ProfileListItem[]> {
  const localFavs = await getLocalFavoriteIds(viewerId);
  const remembered = await getRememberedProfiles();
  const byId = new Map<string, ProfileListItem>();

  for (const item of remembered) {
    if (item.id === viewerId) continue;
    byId.set(item.id, item);
  }
  for (const item of serverItems) {
    if (item.id === viewerId) continue;
    byId.set(item.id, item);
  }

  const merged = [...byId.values()].map((item) => {
    const favorited = Boolean(item.favorited) || localFavs.has(item.id);
    return { ...item, favorited };
  });

  await rememberProfiles(merged);
  return merged;
}

/** Stamp local favorite flags onto a page without pulling the whole directory. */
export async function stampLocalFavorites(
  viewerId: string,
  serverItems: ProfileListItem[],
): Promise<ProfileListItem[]> {
  const localFavs = await getLocalFavoriteIds(viewerId);
  const stamped = serverItems.map((item) => ({
    ...item,
    favorited: Boolean(item.favorited) || localFavs.has(item.id),
  }));
  await rememberProfiles(stamped);
  return stamped;
}

/** Favorites tab: remembered faces marked favorited (survives pagination). */
export async function listLocalFavorites(
  viewerId: string,
): Promise<ProfileListItem[]> {
  const localFavs = await getLocalFavoriteIds(viewerId);
  const remembered = await getRememberedProfiles();
  return remembered
    .filter(
      (item) =>
        item.id !== viewerId &&
        (Boolean(item.favorited) || localFavs.has(item.id)),
    )
    .map((item) => ({ ...item, favorited: true }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
