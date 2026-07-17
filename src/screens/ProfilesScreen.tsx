import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
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
  listLocalFavorites,
  mergeProfilesWithLocal,
  rememberProfiles,
  setLocalFavorite,
  stampLocalFavorites,
} from '../profiles/favoriteStore';
import { useProfileViewer } from '../profiles/ProfileViewerContext';
import { GlassSurface, colors, fonts, radius, space, type } from '../theme';

export type { DirectSendTarget };

type PeopleTab = 'favorites' | 'all';

type ProfilesScreenProps = {
  onSendDirect: (target: DirectSendTarget) => void;
};

const PAGE_SIZE = 50;

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
    ...(item.onboarding?.extraInfo?.trim()
      ? { notes: item.onboarding.extraInfo.trim() }
      : {}),
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
  const [favoriteItems, setFavoriteItems] = useState<ProfileListItem[]>([]);
  const [nextOffset, setNextOffset] = useState<number | undefined>();
  const [loading, setLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [vehicleFilter, setVehicleFilter] = useState<VehicleClass | 'any'>(
    'any',
  );

  const refreshFavoriteTab = useCallback(async () => {
    const viewerId = user?.id ?? '';
    if (!viewerId) {
      setFavoriteItems([]);
      return;
    }
    setFavoriteItems(await listLocalFavorites(viewerId));
  }, [user?.id]);

  const load = useCallback(
    async (
      mode: 'initial' | 'refresh' | 'page' = 'initial',
      pageOffset = 0,
    ) => {
      if (mode === 'refresh') setRefreshing(true);
      else if (mode === 'page') setPageLoading(true);
      else setLoading(true);
      setError(null);
      try {
        const {
          items: remote,
          nextOffset: more,
          fromBoardFallback,
        } = await listProfiles({
          viewerId: user?.id,
          limit: PAGE_SIZE,
          offset: pageOffset,
        });
        const viewerId = user?.id ?? '';
        const next = viewerId
          ? await stampLocalFavorites(viewerId, remote)
          : remote.map((item) => ({
              ...item,
              favorited: Boolean(item.favorited),
            }));
        if (mode === 'page') {
          setItems((prev) => {
            const seen = new Set(prev.map((p) => p.id));
            return [...prev, ...next.filter((p) => !seen.has(p.id))];
          });
        } else {
          setItems(next);
        }
        setNextOffset(fromBoardFallback ? undefined : more);
        if (viewerId) await refreshFavoriteTab();
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
          if (viewerId) {
            const next = await mergeProfilesWithLocal(viewerId, []);
            if (mode !== 'page') setItems(next);
            await refreshFavoriteTab();
          } else if (mode !== 'page') {
            setItems([]);
            setFavoriteItems([]);
          }
        } catch {
          if (mode !== 'page') {
            setItems([]);
            setFavoriteItems([]);
          }
        }
        if (mode !== 'page') setNextOffset(undefined);
        setError(mapApiError(err).message);
      } finally {
        setLoading(false);
        setRefreshing(false);
        setPageLoading(false);
      }
    },
    [refreshFavoriteTab, user?.id],
  );

  useEffect(() => {
    void load('initial', 0);
  }, [load]);

  useEffect(() => {
    if (favoriteEpoch > 0) {
      void load('refresh', 0);
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
    setFavoriteItems((prev) => {
      if (next) {
        const without = prev.filter((p) => p.id !== item.id);
        return [...without, updated].sort((a, b) =>
          a.name.localeCompare(b.name),
        );
      }
      return prev.filter((p) => p.id !== item.id);
    });
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
      await refreshFavoriteTab();
    } finally {
      setTogglingId(null);
    }
  };

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

  const listItems = tab === 'favorites' ? favoriteItems : filteredAll;

  const canLoadMore =
    tab === 'all' && nextOffset != null && !loading && !pageLoading;

  const onEndReached = useCallback(() => {
    if (!canLoadMore || nextOffset == null) return;
    void load('page', nextOffset);
  }, [canLoadMore, load, nextOffset]);

  const listHeader = (
    <View style={styles.headerBlock}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>Drivers</Text>
        <Text style={styles.title}>
          <Text style={styles.titleLead}>Your </Text>
          <Text style={styles.titleItalic}>people</Text>
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

      {error && listItems.length > 0 ? (
        <Text style={styles.inlineError}>{error}</Text>
      ) : null}
    </View>
  );

  const listEmpty = loading && !refreshing ? (
    <LoadingHint label="Loading drivers…" variant="block" />
  ) : error && items.length === 0 && favoriteItems.length === 0 ? (
    <View style={styles.stateBlock}>
      <Text style={styles.errorText}>{error}</Text>
      <Button variant="ghost" onPress={() => void load('initial', 0)}>
        Try again
      </Button>
    </View>
  ) : (
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
  );

  const listFooter =
    tab === 'all' && nextOffset != null ? (
      <View style={styles.footer}>
        <Button
          variant="ghost"
          disabled={pageLoading}
          loading={pageLoading}
          onPress={() => {
            if (nextOffset != null && !pageLoading) {
              void load('page', nextOffset);
            }
          }}
        >
          Load more
        </Button>
      </View>
    ) : pageLoading ? (
      <View style={styles.footer}>
        <LoadingHint label="Loading more…" variant="block" />
      </View>
    ) : (
      <View style={styles.footerSpacer} />
    );

  return (
    <FlatList
      style={styles.scroll}
      data={loading && !refreshing ? [] : listItems}
      keyExtractor={(item) => item.id}
      initialNumToRender={10}
      windowSize={7}
      removeClippedSubviews={Platform.OS === 'android' ? true : undefined}
      keyboardShouldPersistTaps="handled"
      onEndReached={onEndReached}
      onEndReachedThreshold={0.4}
      ItemSeparatorComponent={ProfileListSeparator}
      ListHeaderComponent={listHeader}
      ListEmptyComponent={listEmpty}
      ListFooterComponent={listFooter}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: insets.top + space.xxl,
          paddingBottom: bottomNavClearance(insets.bottom) + space.lg,
        },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void load('refresh', 0)}
          tintColor={colors.accent}
        />
      }
      renderItem={({ item }) => (
        <ProfileRow
          item={item}
          toggling={togglingId === item.id}
          onOpen={() => openProfile(item.id, item)}
          onToggleFavorite={() => void onToggleFavorite(item)}
          onSend={() => onSendDirect(toSendTarget(item))}
        />
      )}
    />
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
          notes={item.onboarding?.extraInfo}
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

function ProfileListSeparator() {
  return <View style={styles.sep} />;
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: space.lg,
    flexGrow: 1,
  },
  headerBlock: {
    gap: space.lg,
    marginBottom: space.lg,
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
  footer: {
    paddingTop: space.md,
    paddingBottom: space.xs,
    alignItems: 'center',
  },
  footerSpacer: {
    height: space.sm,
  },
  sep: {
    height: space.md,
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
