import { apiFetch } from './client';
import type { PublicProfile } from './drives';

export type FavoriteItem = {
  userId: string;
  createdAt: string;
  user: PublicProfile;
};

/** List / add / remove favorites. */
export async function listFavorites(): Promise<FavoriteItem[]> {
  const data = await apiFetch<{ items: FavoriteItem[] }>('/v1/favorites');
  return data.items ?? [];
}

export async function addFavorite(userId: string): Promise<FavoriteItem> {
  const data = await apiFetch<{ favorite: FavoriteItem }>('/v1/favorites', {
    method: 'POST',
    body: JSON.stringify({ userId }),
  });
  return data.favorite;
}

export async function removeFavorite(userId: string): Promise<void> {
  await apiFetch<void>(`/v1/favorites/${userId}`, { method: 'DELETE' });
}
