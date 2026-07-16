import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { mapApiError } from '../api/errors';
import {
  favoriteProfile,
  getProfile,
  unfavoriteProfile,
  type DirectSendTarget,
  type ProfileListItem,
} from '../api/profiles';
import type { PublicProfile } from '../api/drives';
import { useAuth } from '../auth/AuthContext';
import {
  getLocalFavoriteIds,
  rememberProfiles,
  setLocalFavorite,
} from './favoriteStore';
import { ProfileDetailSheet } from '../screens/ProfileDetailSheet';

type ProfileViewerContextValue = {
  openProfile: (
    userId: string,
    seed?: PublicProfile | ProfileListItem | null,
  ) => void;
  closeProfile: () => void;
  /** True while the profile sheet is visible. */
  profileOpen: boolean;
  /** Bumps whenever a favorite is saved — People screen reloads from this. */
  favoriteEpoch: number;
};

const ProfileViewerContext = createContext<ProfileViewerContextValue | null>(
  null,
);

function toListItem(
  seed: PublicProfile | ProfileListItem,
  favorited = false,
): ProfileListItem {
  return {
    ...seed,
    favorited:
      'favorited' in seed ? Boolean(seed.favorited) || favorited : favorited,
  };
}

function toSendTarget(item: ProfileListItem): DirectSendTarget {
  const o = item.onboarding;
  const detailParts: string[] = [];
  if (o?.seats != null) detailParts.push(`${o.seats} seats`);
  if (o?.yearsDrivingUpstate != null) {
    detailParts.push(
      `${o.yearsDrivingUpstate} yr${o.yearsDrivingUpstate === 1 ? '' : 's'} upstate`,
    );
  }
  const lat = item.lastLat != null ? Number(item.lastLat) : undefined;
  const lng = item.lastLng != null ? Number(item.lastLng) : undefined;
  return {
    id: item.id,
    name: item.name,
    availability: item.availability ?? 'offline',
    vehicleType: o?.vehicleType,
    photoUri: o?.selfPhotoUri,
    vehicleInteriorUri: o?.vehicleInteriorUri,
    vehicleExteriorUri: o?.vehicleExteriorUri,
    detail: detailParts.length ? detailParts.join(' · ') : undefined,
    ...(o?.extraInfo?.trim() ? { notes: o.extraInfo.trim() } : {}),
    ...(lat != null && Number.isFinite(lat) ? { lastLat: lat } : {}),
    ...(lng != null && Number.isFinite(lng) ? { lastLng: lng } : {}),
  };
}

type ProfileViewerProviderProps = {
  children: ReactNode;
  onSendDirect: (target: DirectSendTarget) => void;
};

/**
 * App-wide profile opener — People, board cards, applicants, completed jobs.
 */
export function ProfileViewerProvider({
  children,
  onSendDirect,
}: ProfileViewerProviderProps) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<ProfileListItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [favoriting, setFavoriting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [favoriteEpoch, setFavoriteEpoch] = useState(0);
  const requestGen = useRef(0);
  const openUserId = useRef<string | null>(null);

  const closeProfile = useCallback(() => {
    requestGen.current += 1;
    openUserId.current = null;
    setOpen(false);
    setProfile(null);
    setError(null);
    setLoading(false);
  }, []);

  const openProfile = useCallback(
    (userId: string, seed?: PublicProfile | ProfileListItem | null) => {
      if (!userId || userId === user?.id) return;
      // Nested Modal + MapView freezes hard — ignore duplicate opens.
      if (open && openUserId.current === userId) return;

      const gen = ++requestGen.current;
      openUserId.current = userId;

      setOpen(true);
      setError(null);
      if (seed?.id === userId) {
        setProfile(toListItem(seed));
        setLoading(true);
      } else {
        setProfile(null);
        setLoading(true);
      }

      void (async () => {
        try {
          const next = await getProfile(userId);
          if (gen !== requestGen.current) return;
          if (!next?.id) {
            throw new Error('Profile missing id');
          }
          const localFavs = user?.id
            ? await getLocalFavoriteIds(user.id)
            : new Set<string>();
          if (gen !== requestGen.current) return;
          const merged = {
            ...next,
            favorited: Boolean(next.favorited) || localFavs.has(userId),
          };
          await rememberProfiles([merged]);
          if (gen !== requestGen.current) return;
          setProfile(merged);
        } catch (err) {
          if (gen !== requestGen.current) return;
          setError(mapApiError(err).message);
          if (!seed) setProfile(null);
        } finally {
          if (gen === requestGen.current) setLoading(false);
        }
      })();
    },
    [open, user?.id],
  );

  const onToggleFavorite = useCallback(async () => {
    if (!profile || !user?.id) return;
    setFavoriting(true);
    setError(null);
    const next = !profile.favorited;
    const previous = profile.favorited;
    const updated = { ...profile, favorited: next };
    setProfile(updated);
    try {
      await setLocalFavorite(user.id, profile.id, next);
      await rememberProfiles([updated]);
      if (next) await favoriteProfile(profile.id);
      else await unfavoriteProfile(profile.id);
      setFavoriteEpoch((n) => n + 1);
    } catch (err) {
      await setLocalFavorite(user.id, profile.id, previous);
      setProfile({ ...profile, favorited: previous });
      setError(mapApiError(err).message);
    } finally {
      setFavoriting(false);
    }
  }, [profile, user?.id]);

  const value = useMemo(
    () => ({
      openProfile,
      closeProfile,
      profileOpen: open,
      favoriteEpoch,
    }),
    [openProfile, closeProfile, open, favoriteEpoch],
  );

  return (
    <ProfileViewerContext.Provider value={value}>
      {children}
      <ProfileDetailSheet
        visible={open}
        profile={profile}
        favoriting={favoriting}
        loading={loading}
        error={error}
        onClose={closeProfile}
        onToggleFavorite={() => void onToggleFavorite()}
        onSendDirect={() => {
          if (profile) onSendDirect(toSendTarget(profile));
          closeProfile();
        }}
      />
    </ProfileViewerContext.Provider>
  );
}

export function useProfileViewer(): ProfileViewerContextValue {
  const ctx = useContext(ProfileViewerContext);
  if (!ctx) {
    return {
      openProfile: () => {},
      closeProfile: () => {},
      profileOpen: false,
      favoriteEpoch: 0,
    };
  }
  return ctx;
}
