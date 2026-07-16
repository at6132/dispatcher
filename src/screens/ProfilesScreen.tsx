import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Send, Heart } from 'lucide-react-native';

import {
  favoriteProfile,
  listProfiles,
  unfavoriteProfile,
  type DirectSendTarget,
  type ProfileListItem,
} from '../api/profiles';
import { mapApiError } from '../api/errors';
import { useAuth } from '../auth/AuthContext';
import {
  VEHICLE_CLASS_OPTIONS,
  type VehicleClass,
} from '../auth/types';
import { bottomNavClearance } from '../components/navigation/BottomNav';
import { Button } from '../components/ui/Button';
import { ChoiceGroup } from '../components/ui/ChoiceGroup';
import { DriverCard } from '../components/ui/DriverCard';
import { Icon } from '../components/ui/Icon';
import { LoadingHint } from '../components/ui/LoadingHint';
import { TextField } from '../components/ui/TextField';
import {
  mergeProfilesWithLocal,
  rememberProfiles,
  setLocalFavorite,
} from '../profiles/favoriteStore';
import { useProfileViewer } from '../profiles/ProfileViewerContext';
import { GlassSurface, colors, fonts, radius, space, type } from '../theme';

export type { DirectSendTarget };

type PeopleTab = 'favorites' | 'all';

type ProfilesScreenProps = {
  onSendDirect: (target: DirectSendTarget) => void;
};

const VEHICLE_FILTER_OPTIONS: { value: VehicleClass | 'any'; label: string }[] =
  [{ value: 'any', label: 'Any' }, ...VEHICLE_CLASS_OPTIONS];

function profileDetail(item: ProfileListItem): string | undefined {
  const o = item.onboarding;
  if (!o) return undefined;
  const parts: string[] = [];
  if (o.seats != null) parts.push(`${o.seats} seats`);
  if (o.yearsDrivingUpstate != null) {
    parts.push(
      `${o.yearsDrivingUpstate} yr${o.yearsDrivingUpstate === 1 ? '' : 's'} upstate`,
    );
  }
  return parts.length ? parts.join(' · ') : undefined;
}

function toSendTarget(item: ProfileListItem): DirectSendTarget {
  const lat = item.lastLat != null ? Number(item.lastLat) : undefined;
  const lng = item.lastLng != null ? Number(item.lastLng) : undefined;
  return {
    id: item.id,
    name: item.name,
    availability: item.availability ?? 'offline',
    vehicleType: item.onboarding?.vehicleType,
    photoUri: item.onboarding?.selfPhotoUri,
    vehicleInteriorUri: item.onboarding?.vehicleInteriorUri,
    vehicleExteriorUri: item.onboarding?.vehicleExteriorUri,
    detail: profileDetail(item),
    ...(lat != null && Number.isFinite(lat) ? { lastLat: lat } : {}),
    ...(lng != null && Number.isFinite(lng) ? { lastLng: lng } : {}),
  };
}

export function ProfilesScreen({ onSendDirect }: ProfilesScreenProps) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { openProfile, favoriteEpoch } = useProfileViewer();
  const [tab, setTab] = useState<PeopleTab>('favorites');
  const [items, setItems] = useState<ProfileListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [vehicleFilter, setVehicleFilter] = useState<VehicleClass | 'any'>(
    'any',
  );

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (mode === 'refresh') setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const { items: remote, fromBoardFallback } = await listProfiles({
          viewerId: user?.id,
        });
        const viewerId = user?.id ?? '';
        const next = viewerId
          ? await mergeProfilesWithLocal(viewerId, remote)
          : remote.map((item) => ({
              ...item,
              favorited: Boolean(item.favorited),
            }));
        setItems(next);
        if (fromBoardFallback) {
          setError(
            next.length === 0
              ? 'No other drivers on the board yet. Pull to refresh after people post.'
              : 'Showing drivers from recent board activity. Pull to refresh for the latest list.',
          );
        }
      } catch (err) {
        // Still surface local favorites / remembered faces
        try {
          const viewerId = user?.id ?? '';
          const next = viewerId
            ? await mergeProfilesWithLocal(viewerId, [])
            : [];
          setItems(next);
        } catch {
          setItems([]);
        }
        setError(mapApiError(err).message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [user?.id],
  );

  useEffect(() => {
    void load('initial');
  }, [load]);

  useEffect(() => {
    if (favoriteEpoch > 0) {
      void load('refresh');
    }
  }, [favoriteEpoch, load]);

  const onToggleFavorite = async (item: ProfileListItem) => {
    if (!user?.id) return;
    setTogglingId(item.id);
    const next = !item.favorited;
    const updated = { ...item, favorited: next };
    setItems((prev) =>
      prev.map((p) => (p.id === item.id ? updated : p)),
    );
    try {
      await setLocalFavorite(user.id, item.id, next);
      await rememberProfiles([updated]);
      if (next) await favoriteProfile(item.id);
      else await unfavoriteProfile(item.id);
    } catch (err) {
      setError(mapApiError(err).message);
      await setLocalFavorite(user.id, item.id, item.favorited);
      setItems((prev) =>
        prev.map((p) =>
          p.id === item.id ? { ...p, favorited: item.favorited } : p,
        ),
      );
    } finally {
      setTogglingId(null);
    }
  };

  const favorites = useMemo(
    () => items.filter((i) => i.favorited),
    [items],
  );

  const filteredAll = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = items.filter((item) => {
      if (
        vehicleFilter !== 'any' &&
        item.onboarding?.vehicleClass !== vehicleFilter
      ) {
        return false;
      }
      if (!q) return true;
      const haystack = [
        item.name,
        item.onboarding?.vehicleType,
        item.onboarding?.vehicleClass,
        item.onboarding?.extraInfo,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
    // Favorites float to the top of All (incl. search / vehicle tags)
    return filtered.sort((a, b) => {
      if (a.favorited !== b.favorited) return a.favorited ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [items, query, vehicleFilter]);

  const listItems = tab === 'favorites' ? favorites : filteredAll;

  return (
    <>
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: insets.top + space.xxl,
          paddingBottom: bottomNavClearance(insets.bottom) + space.lg,
        },
      ]}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void load('refresh')}
          tintColor={colors.accent}
        />
      }
    >
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>Drivers</Text>
        <Text style={styles.title}>
          <Text style={styles.titleLead}>Your </Text>
          <Text style={styles.titleItalic}>people</Text>
        </Text>
        <Text style={styles.support}>
          Favorites are drivers you trust. Open All to browse, tap the heart to
          save them, then send a job directly from their profile.
        </Text>
      </View>

      <View style={styles.tabs} accessibilityRole="tablist">
        {(
          [
            { key: 'favorites', label: 'Favorites' },
            { key: 'all', label: 'All' },
          ] as const
        ).map((t) => {
          const active = tab === t.key;
          return (
            <Pressable
              key={t.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => setTab(t.key)}
              style={[styles.tab, active && styles.tabActive]}
            >
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {tab === 'all' ? (
        <View style={styles.filters}>
          <TextField
            label="Search"
            value={query}
            onChangeText={setQuery}
            placeholder="Name, minivan, Sienna…"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <ChoiceGroup
            label="Vehicle"
            options={VEHICLE_FILTER_OPTIONS}
            value={vehicleFilter}
            onChange={setVehicleFilter}
          />
        </View>
      ) : null}

      {loading && !refreshing ? (
        <LoadingHint label="Loading drivers…" variant="block" />
      ) : error && items.length === 0 ? (
        <View style={styles.stateBlock}>
          <Text style={styles.errorText}>{error}</Text>
          <Button variant="ghost" onPress={() => void load('initial')}>
            Try again
          </Button>
        </View>
      ) : listItems.length === 0 ? (
        <View style={styles.stateBlock}>
          {error ? <Text style={styles.inlineError}>{error}</Text> : null}
          <Text style={styles.empty}>
            {tab === 'favorites'
              ? 'No favorites yet. Open All, then tap the heart on drivers you trust.'
              : query.trim() || vehicleFilter !== 'any'
                ? 'No drivers match that search.'
                : 'No other drivers on the board yet.'}
          </Text>
          {tab === 'favorites' ? (
            <Button variant="ghost" onPress={() => setTab('all')}>
              Browse all drivers
            </Button>
          ) : null}
        </View>
      ) : (
        <View style={styles.list}>
          {error ? <Text style={styles.inlineError}>{error}</Text> : null}
          {listItems.map((item) => (
            <ProfileRow
              key={item.id}
              item={item}
              toggling={togglingId === item.id}
              onOpen={() => openProfile(item.id, item)}
              onToggleFavorite={() => void onToggleFavorite(item)}
              onSend={() => onSendDirect(toSendTarget(item))}
            />
          ))}
        </View>
      )}
    </ScrollView>
    </>
  );
}

type ProfileRowProps = {
  item: ProfileListItem;
  toggling: boolean;
  onOpen: () => void;
  onToggleFavorite: () => void;
  onSend: () => void;
};

function ProfileRow({
  item,
  toggling,
  onOpen,
  onToggleFavorite,
  onSend,
}: ProfileRowProps) {
  return (
    <GlassSurface style={styles.rowCard} contentStyle={styles.rowInner}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${item.name} profile`}
        onPress={onOpen}
        style={({ pressed }) => [
          styles.rowPress,
          pressed && styles.rowPressed,
        ]}
      >
        <DriverCard
          name={item.name}
          vehicleType={item.onboarding?.vehicleType}
          detail={profileDetail(item)}
          photoUri={item.onboarding?.selfPhotoUri}
          vehicleInteriorUri={item.onboarding?.vehicleInteriorUri}
          vehicleExteriorUri={item.onboarding?.vehicleExteriorUri}
          showMap={false}
          favorited={item.favorited}
          availability={item.availability ?? 'offline'}
        />
        <Text style={styles.openHint}>Tap for full profile</Text>
      </Pressable>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            item.favorited ? 'Remove favorite' : 'Add favorite'
          }
          disabled={toggling}
          onPress={onToggleFavorite}
          style={({ pressed }) => [
            styles.iconBtn,
            item.favorited && styles.favoriteBtnActive,
            pressed && styles.iconBtnPressed,
            toggling && styles.iconBtnDisabled,
          ]}
          hitSlop={8}
        >
          <Icon
            icon={Heart}
            size="md"
            color={item.favorited ? colors.danger : colors.ink}
            strokeWidth={item.favorited ? 2.2 : 1.7}
            fill={item.favorited ? colors.danger : 'transparent'}
          />
          <Text style={[styles.actionLabel, styles.actionLabelActive]}>
            {item.favorited ? 'Favorited' : 'Favorite'}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Send job to ${item.name}`}
          onPress={onSend}
          style={({ pressed }) => [
            styles.iconBtn,
            styles.sendBtn,
            pressed && styles.iconBtnPressed,
          ]}
          hitSlop={8}
        >
          <Icon icon={Send} size="md" color={colors.ink} strokeWidth={1.75} />
          <Text style={[styles.actionLabel, styles.actionLabelActive]}>
            Send
          </Text>
        </Pressable>
      </View>
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: space.lg,
    gap: space.lg,
  },
  hero: {
    gap: space.sm,
    marginBottom: space.xs,
  },
  eyebrow: {
    ...type.label,
    color: colors.muted,
  },
  title: {
    flexDirection: 'row',
  },
  titleLead: {
    ...type.hero,
    color: colors.ink,
  },
  titleItalic: {
    ...type.heroItalic,
    color: colors.ink,
  },
  support: {
    ...type.body,
    fontFamily: fonts.sans,
    color: colors.inkSoft,
    maxWidth: 340,
  },
  tabs: {
    flexDirection: 'row',
    gap: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.glassBorder,
  },
  tab: {
    paddingVertical: space.sm,
    paddingHorizontal: space.xs,
    marginRight: space.md,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: colors.accent,
  },
  tabLabel: {
    ...type.label,
    fontFamily: fonts.sansMedium,
    color: colors.muted,
  },
  tabLabelActive: {
    color: colors.ink,
  },
  filters: {
    gap: space.md,
  },
  stateBlock: {
    gap: space.md,
    paddingVertical: space.xl,
  },
  errorText: {
    ...type.body,
    color: colors.danger,
  },
  inlineError: {
    ...type.caption,
    color: colors.danger,
    marginBottom: space.sm,
  },
  empty: {
    ...type.body,
    color: colors.muted,
  },
  list: {
    gap: space.md,
  },
  rowCard: {
    borderRadius: radius.lg,
  },
  rowInner: {
    gap: space.md,
    padding: space.md,
  },
  rowPress: {
    gap: space.sm,
  },
  rowPressed: {
    opacity: 0.9,
  },
  openHint: {
    ...type.caption,
    color: colors.faint,
    marginTop: space.xs,
  },
  statusTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
  },
  statusTagLabel: {
    ...type.label,
    color: colors.inkSoft,
  },
  actions: {
    flexDirection: 'row',
    gap: space.sm,
  },
  iconBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.control,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.field,
  },
  favoriteBtnActive: {
    backgroundColor: 'rgba(208, 138, 138, 0.14)',
    borderColor: colors.danger,
  },
  sendBtn: {
    backgroundColor: colors.accentMuted,
  },
  iconBtnPressed: {
    opacity: 0.88,
  },
  iconBtnDisabled: {
    opacity: 0.55,
  },
  actionLabel: {
    ...type.label,
    fontFamily: fonts.sansMedium,
    color: colors.muted,
  },
  actionLabelActive: {
    color: colors.ink,
  },
});
