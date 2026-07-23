import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
} from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  applyToDrive,
  listDirectOffers,
  listDrives,
  markDrivePickedUp,
  requestDriveCancel,
  type Drive,
  type DriveBoard,
  type DriveListItem,
  type DriverAvailability,
} from '../api/drives';
import { createIdempotencyKey } from '../api/client';
import { isApiError, mapApiError } from '../api/errors';
import { useAuth } from '../auth/AuthContext';
import { alertMessage, confirmAction } from '../ui/confirm';
import { logger } from '../debug/logger';
import { bottomNavClearance } from '../components/navigation/BottomNav';
import { Button } from '../components/ui/Button';
import { CompleteDriveModal } from '../components/ui/CompleteDriveModal';
import { DriveCard } from '../components/ui/DriveCard';
import { IncomingJobModal } from '../components/ui/IncomingJobModal';
import { LoadingHint } from '../components/ui/LoadingHint';
import { driverMatchesOpenDrive } from '../drives/matchDrive';
import { useDriverLocation } from '../location/LocationContext';
import { useNetwork } from '../network/NetworkContext';
import { useProfileViewer } from '../profiles/ProfileViewerContext';
import { GlassSurface, colors, fonts, radius, space, type } from '../theme';

const BOARDS: {
  key: DriveBoard;
  label: string;
  empty: string;
}[] = [
  {
    key: 'open',
    label: 'Open',
    empty: 'No open drives match your vehicle right now.',
  },
  { key: 'active', label: 'Active', empty: 'No active jobs yet.' },
  { key: 'history', label: 'History', empty: 'No completed jobs yet.' },
];

const BOARD_COUNT = BOARDS.length;
const PAGE_SIZE = 50;

const AVAILABILITY_OPTIONS: {
  value: DriverAvailability;
  label: string;
}[] = [
  { value: 'available', label: 'Available' },
  { value: 'busy', label: 'Busy' },
  { value: 'offline', label: 'Offline' },
];

function availabilityTone(status: DriverAvailability) {
  switch (status) {
    case 'available':
      return colors.success;
    case 'busy':
      return colors.accent;
    default:
      return colors.muted;
  }
}

function keyForAction(keys: Map<string, string>, action: string): string {
  const existing = keys.get(action);
  if (existing) return existing;
  const created = createIdempotencyKey();
  keys.set(action, created);
  return created;
}

type BoardState = {
  items: DriveListItem[];
  loading: boolean;
  refreshing: boolean;
  pageLoading: boolean;
  error: string | null;
  loaded: boolean;
  offset: number;
  nextOffset?: number;
};

const emptyBoard = (): BoardState => ({
  items: [],
  loading: false,
  refreshing: false,
  pageLoading: false,
  error: null,
  loaded: false,
  offset: 0,
  nextOffset: undefined,
});

type ActiveSection = {
  key: 'dispatched' | 'my_drives';
  title: string;
  data: DriveListItem[];
};

function splitActiveSections(
  items: DriveListItem[],
  viewerId: string | undefined,
): ActiveSection[] {
  const dispatched: DriveListItem[] = [];
  const myDrives: DriveListItem[] = [];
  for (const item of items) {
    if (viewerId != null && item.posterId === viewerId) {
      dispatched.push(item);
    } else {
      myDrives.push(item);
    }
  }
  return [
    { key: 'dispatched', title: 'Dispatched', data: dispatched },
    { key: 'my_drives', title: 'My Drives', data: myDrives },
  ];
}

/** Oldest completed = Trip 0. Uses loaded history only (board limit 50). */
function historyTripNumbers(items: DriveListItem[]): Map<string, number> {
  const sorted = [...items].sort((a, b) => {
    const ta = new Date(a.completedAt ?? a.updatedAt ?? a.createdAt).getTime();
    const tb = new Date(b.completedAt ?? b.updatedAt ?? b.createdAt).getTime();
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });
  const map = new Map<string, number>();
  sorted.forEach((d, i) => map.set(d.id, i));
  return map;
}

type HomeScreenProps = {
  /** Bump to refetch boards after an external mutation. */
  refreshToken?: number;
  /** Manage a drive you posted (open applicants, or active/history status). */
  onManageDrive?: (drive: DriveListItem) => void;
};

export function HomeScreen({
  refreshToken = 0,
  onManageDrive,
}: HomeScreenProps) {
  const insets = useSafeAreaInsets();
  const { user, updatePresence } = useAuth();
  const { refreshLocation } = useDriverLocation();
  const { isConnected } = useNetwork();
  const { openProfile } = useProfileViewer();
  const pagerRef = useRef<ComponentRef<typeof Animated.ScrollView>>(null);
  const { width: pageWidth } = useWindowDimensions();
  const scrollX = useRef(new Animated.Value(0)).current;
  const indexRef = useRef(0);
  const [index, setIndex] = useState(0);
  const [trackWidth, setTrackWidth] = useState(0);
  const [presenceBusy, setPresenceBusy] = useState(false);
  const [boards, setBoards] = useState<Record<DriveBoard, BoardState>>({
    open: emptyBoard(),
    active: emptyBoard(),
    history: emptyBoard(),
  });
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [appliedIds, setAppliedIds] = useState<Set<string>>(() => new Set());
  const [applyError, setApplyError] = useState<{
    driveId: string;
    message: string;
  } | null>(null);
  const [completingDrive, setCompletingDrive] = useState<DriveListItem | null>(
    null,
  );
  const [pickingUpId, setPickingUpId] = useState<string | null>(null);
  const [pickupError, setPickupError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [incomingOffer, setIncomingOffer] = useState<DriveListItem | null>(
    null,
  );
  /** Stop 8s offer polling after auth death so we don't spam 401s. */
  const offersPollStoppedRef = useRef(false);
  const mutationKeysRef = useRef(new Map<string, string>());

  const pollOffers = useCallback(async () => {
    if (!isConnected || !user?.id || offersPollStoppedRef.current) return;
    try {
      const offers = await listDirectOffers({
        viewerId: user.id,
        limit: 10,
      });
      setIncomingOffer((current) => {
        if (current && offers.some((o) => o.id === current.id)) return current;
        return offers[0] ?? null;
      });
    } catch (err) {
      if (isApiError(err) && err.status === 401) {
        offersPollStoppedRef.current = true;
        logger.warn('home', 'offers_poll_stopped_unauthorized');
        return;
      }
      // Older APIs / offline — no offer popup
    }
  }, [isConnected, user?.id]);

  const onSetAvailability = async (availability: DriverAvailability) => {
    if (!user) return;
    const previous = user.availability ?? 'offline';
    setPresenceBusy(true);
    try {
      await updatePresence({ availability });
    } catch {
      try {
        await updatePresence({ availability: previous });
      } catch {
        // ignore revert failure
      }
      setPresenceBusy(false);
      return;
    }
    if (availability !== 'offline') {
      try {
        const coord = await refreshLocation();
        if (coord) {
          await updatePresence({ lat: coord.lat, lng: coord.lng });
        }
      } catch {
        // ignore
      }
    }
    setPresenceBusy(false);
  };

  const loadBoard = useCallback(
    async (
      board: DriveBoard,
      mode: 'initial' | 'refresh' | 'page' = 'initial',
      pageOffset = 0,
    ) => {
      setBoards((prev) => ({
        ...prev,
        [board]: {
          ...prev[board],
          loading: mode === 'initial' && !prev[board].loaded,
          refreshing: mode === 'refresh',
          pageLoading: mode === 'page',
          error: null,
        },
      }));
      try {
        const useOffsetPaging = board === 'open';
        const result = await listDrives(board, {
          limit: PAGE_SIZE,
          ...(useOffsetPaging ? { offset: pageOffset } : {}),
        });
        const capacity = user?.onboarding
          ? {
              vehicleClass: user.onboarding.vehicleClass,
              seats: user.onboarding.seats,
            }
          : null;
        const items =
          board === 'open'
            ? result.items.filter(
                (d) =>
                  d.status === 'open' &&
                  driverMatchesOpenDrive(capacity, d, user?.id),
              )
            : result.items;
        setBoards((prev) => ({
          ...prev,
          [board]: {
            items,
            loading: false,
            refreshing: false,
            pageLoading: false,
            error: null,
            loaded: true,
            offset: useOffsetPaging ? pageOffset : 0,
            nextOffset: useOffsetPaging ? result.nextOffset : undefined,
          },
        }));
        if (board === 'open') {
          setAppliedIds((prev) => {
            const next = new Set(prev);
            for (const item of items) {
              const status = item.viewerApplicationStatus;
              if (status === 'pending' || status === 'accepted') {
                next.add(item.id);
              } else if (status === 'cleared' || status == null) {
                next.delete(item.id);
              }
            }
            return next;
          });
        }
      } catch (err) {
        setBoards((prev) => ({
          ...prev,
          [board]: {
            ...prev[board],
            loading: false,
            refreshing: false,
            pageLoading: false,
            error: mapApiError(err).message,
            loaded: prev[board].loaded,
            ...(mode === 'page' ? {} : { nextOffset: undefined }),
          },
        }));
      }
    },
    [user?.id, user?.onboarding],
  );

  useEffect(() => {
    void loadBoard(BOARDS[index].key);
  }, [index, loadBoard, refreshToken]);

  useEffect(() => {
    if (isConnected) {
      offersPollStoppedRef.current = false;
      void pollOffers();
    }
    const id = setInterval(() => {
      if (!isConnected) return;
      if (offersPollStoppedRef.current) {
        clearInterval(id);
        return;
      }
      void pollOffers();
    }, 8_000);
    return () => clearInterval(id);
  }, [isConnected, pollOffers, refreshToken]);

  useEffect(() => {
    const timers = BOARDS.map((b, i) =>
      i === index
        ? null
        : setTimeout(() => {
            void loadBoard(b.key);
          }, 400 + i * 120),
    );
    return () => {
      timers.forEach((t) => t && clearTimeout(t));
    };
  }, [loadBoard, refreshToken, index]);

  const setIndexSafe = (next: number) => {
    if (next === indexRef.current) return;
    if (next < 0 || next >= BOARD_COUNT) return;
    indexRef.current = next;
    setIndex(next);
  };

  const goTo = (next: number) => {
    const clamped = Math.max(0, Math.min(BOARD_COUNT - 1, next));
    setIndexSafe(clamped);
    (
      pagerRef.current as
        | { scrollTo: (options: { x: number; animated: boolean }) => void }
        | null
    )?.scrollTo({ x: clamped * pageWidth, animated: true });
  };

  const onTrackLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && w !== trackWidth) setTrackWidth(w);
  };

  const onScroll = Animated.event(
    [{ nativeEvent: { contentOffset: { x: scrollX } } }],
    {
      useNativeDriver: true,
      listener: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const next = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
        setIndexSafe(next);
      },
    },
  );

  const segmentWidth = trackWidth > 0 ? trackWidth / BOARD_COUNT : 0;

  const pageStops = BOARDS.map((_, i) => i * pageWidth);
  const thumbStops = BOARDS.map((_, i) => i * segmentWidth);

  // Mid-swipe warp: stretch at halfway points, settle on each page.
  // scaleX uses the view center as origin — do not left-compensate translateX
  // or the thumb drifts under the middle (Active) label.
  const warpInput = pageStops.flatMap((p, i) =>
    i < BOARD_COUNT - 1 ? [p, p + pageWidth * 0.5] : [p],
  );
  const warpScale = pageStops.flatMap((_, i) =>
    i < BOARD_COUNT - 1 ? [1, 1.28] : [1],
  );

  const thumbTranslate = scrollX.interpolate({
    inputRange: pageStops,
    outputRange: thumbStops.length ? thumbStops : [0, 0, 0],
    extrapolate: 'clamp',
  });

  const thumbScaleX = scrollX.interpolate({
    inputRange: warpInput.length ? warpInput : [0, 1],
    outputRange: warpScale.length ? warpScale : [1, 1],
    extrapolate: 'clamp',
  });

  const onApply = useCallback(async (driveId: string) => {
    const action = `apply:${driveId}`;
    const idempotencyKey = keyForAction(mutationKeysRef.current, action);
    setApplyError(null);
    setApplyingId(driveId);
    try {
      const coords = await refreshLocation();
      await applyToDrive(driveId, coords ?? undefined, { idempotencyKey });
      mutationKeysRef.current.delete(action);
      setAppliedIds((prev) => new Set(prev).add(driveId));
    } catch (err) {
      const mapped = mapApiError(err);
      if (mapped.code === 'already_applied') {
        mutationKeysRef.current.delete(action);
        setAppliedIds((prev) => new Set(prev).add(driveId));
      } else {
        setApplyError({ driveId, message: mapped.message });
        alertMessage('Can’t apply', mapped.message);
      }
    } finally {
      setApplyingId(null);
    }
  }, [refreshLocation]);

  const onPickedUp = useCallback(async (driveId: string) => {
    const action = `picked-up:${driveId}`;
    const idempotencyKey = keyForAction(mutationKeysRef.current, action);
    setPickupError(null);
    setPickingUpId(driveId);
    try {
      const updated = await markDrivePickedUp(driveId, { idempotencyKey });
      mutationKeysRef.current.delete(action);
      setBoards((prev) => ({
        ...prev,
        active: {
          ...prev.active,
          items: prev.active.items.map((d) =>
            d.id === driveId ? { ...d, ...updated, status: 'picked_up' } : d,
          ),
        },
      }));
    } catch (err) {
      setPickupError(mapApiError(err).message);
    } finally {
      setPickingUpId(null);
    }
  }, []);

  const onRequestCancel = useCallback((driveId: string) => {
    void (async () => {
      const ok = await confirmAction({
        title: 'Cancel this ride?',
        message:
          'The dispatcher will get a notification and must approve before the ride is cancelled.',
        confirmLabel: 'Request cancel',
        cancelLabel: 'Keep ride',
        destructive: true,
      });
      if (!ok) return;
      const action = `cancel-request:${driveId}`;
      const idempotencyKey = keyForAction(mutationKeysRef.current, action);
      setCancelError(null);
      setCancellingId(driveId);
      try {
        const updated = await requestDriveCancel(driveId, {
          idempotencyKey,
        });
        mutationKeysRef.current.delete(action);
        setBoards((prev) => ({
          ...prev,
          active: {
            ...prev.active,
            items: prev.active.items.map((d) =>
              d.id === driveId ? { ...d, ...updated } : d,
            ),
          },
        }));
      } catch (err) {
        setCancelError(mapApiError(err).message);
      } finally {
        setCancellingId(null);
      }
    })();
  }, []);

  const onComplete = useCallback((drive: DriveListItem) => {
    setCompletingDrive(drive);
  }, []);

  const onDriveCompleted = (driveId: string, updated: Drive) => {
    setCompletingDrive(null);
    setBoards((prev) => {
      const fromActive = prev.active.items.find((d) => d.id === driveId);
      if (!fromActive) {
        return {
          ...prev,
          active: {
            ...prev.active,
            items: prev.active.items.filter((d) => d.id !== driveId),
          },
        };
      }
      const historyItem: DriveListItem = {
        ...fromActive,
        ...updated,
        status: 'completed',
        poster: fromActive.poster,
        assignee: fromActive.assignee,
        assigneeLat: fromActive.assigneeLat,
        assigneeLng: fromActive.assigneeLng,
      };
      return {
        ...prev,
        active: {
          ...prev.active,
          items: prev.active.items.filter((d) => d.id !== driveId),
        },
        history: {
          ...prev.history,
          items: [
            historyItem,
            ...prev.history.items.filter((d) => d.id !== driveId),
          ],
          loaded: true,
        },
      };
    });
    goTo(2);
    void loadBoard('history', 'refresh');
  };

  const padBottom = bottomNavClearance(insets.bottom) + space.lg;

  const activeSections = useMemo(
    () => splitActiveSections(boards.active.items, user?.id),
    [boards.active.items, user?.id],
  );

  const historyTripById = useMemo(
    () => historyTripNumbers(boards.history.items),
    [boards.history.items],
  );

  const renderDriveCard = useCallback(
    (
      item: DriveListItem,
      board: DriveBoard,
      opts?: { showMap?: boolean },
    ) => {
      const status = item.viewerApplicationStatus;
      const applied =
        appliedIds.has(item.id) ||
        status === 'pending' ||
        status === 'accepted';
      const applyAgain = !applied && status === 'cleared';
      return (
        <DriveCard
          drive={item}
          board={board}
          viewerId={user?.id}
          onApply={board === 'open' ? onApply : undefined}
          onManage={
            onManageDrive != null &&
            (board === 'open' || board === 'active' || board === 'history')
              ? onManageDrive
              : undefined
          }
          onPickedUp={board === 'active' ? onPickedUp : undefined}
          onComplete={board === 'active' ? onComplete : undefined}
          onRequestCancel={board === 'active' ? onRequestCancel : undefined}
          applying={applyingId === item.id}
          applied={applied}
          pickingUp={pickingUpId === item.id}
          cancelling={cancellingId === item.id}
          applyError={
            applyError?.driveId === item.id ? applyError.message : null
          }
          applyAgain={applyAgain}
          showMap={opts?.showMap}
          onOpenProfile={openProfile}
          tripNumber={
            board === 'history' ? historyTripById.get(item.id) : undefined
          }
        />
      );
    },
    [
      user?.id,
      onManageDrive,
      appliedIds,
      applyingId,
      pickingUpId,
      cancellingId,
      applyError,
      historyTripById,
      openProfile,
      onApply,
      onPickedUp,
      onRequestCancel,
      onComplete,
    ],
  );

  const listEmpty = (board: (typeof BOARDS)[number], state: BoardState) => (
    <View style={styles.empty}>
      {state.error ? (
        <>
          <Text style={styles.emptyTitle}>Couldn’t load</Text>
          <Text style={styles.emptyBody}>{state.error}</Text>
          <Button variant="ghost" onPress={() => void loadBoard(board.key)}>
            Try again
          </Button>
        </>
      ) : (
        <>
          <Text style={styles.emptyTitle}>{board.empty}</Text>
          <Text style={styles.emptyBody}>
            Pull to refresh when something new posts.
          </Text>
        </>
      )}
    </View>
  );

  return (
    <View style={styles.root}>
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + space.lg,
            paddingHorizontal: space.xl,
          },
        ]}
      >
        <View style={styles.presenceBlock}>
          <Text style={styles.presenceLabel}>Your status</Text>
          <View style={styles.presenceRow}>
            {AVAILABILITY_OPTIONS.map((opt) => {
              const active = (user?.availability ?? 'offline') === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  disabled={presenceBusy}
                  onPress={() => void onSetAvailability(opt.value)}
                  style={[
                    styles.statusChip,
                    active && styles.statusChipActive,
                    presenceBusy && styles.statusChipDisabled,
                  ]}
                >
                  <View
                    style={[
                      styles.statusDot,
                      { backgroundColor: availabilityTone(opt.value) },
                    ]}
                  />
                  <Text
                    style={[
                      styles.statusChipLabel,
                      active && styles.statusChipLabelActive,
                    ]}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        <GlassSurface style={styles.pill} contentStyle={styles.pillInner} flat>
          <View
            style={styles.segments}
            accessibilityRole="tablist"
            onLayout={onTrackLayout}
          >
            {segmentWidth > 0 ? (
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.thumb,
                  {
                    width: segmentWidth,
                    transform: [
                      { translateX: thumbTranslate },
                      { scaleX: thumbScaleX },
                    ],
                  },
                ]}
              />
            ) : null}
            {BOARDS.map((b, i) => {
              const selected = i === index;
              return (
                <Pressable
                  key={b.key}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  onPress={() => goTo(i)}
                  style={[
                    styles.segment,
                    segmentWidth > 0
                      ? { width: segmentWidth }
                      : styles.segmentFlex,
                  ]}
                >
                  <Text
                    style={[
                      styles.segmentLabel,
                      selected && styles.segmentLabelOn,
                    ]}
                  >
                    {b.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </GlassSurface>
      </View>

      <Animated.ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        nestedScrollEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        style={styles.pager}
        contentContainerStyle={{ width: pageWidth * BOARD_COUNT }}
      >
        {BOARDS.map((b) => {
          const state = boards[b.key];
          const refresh = (
            <RefreshControl
              refreshing={state.refreshing}
              onRefresh={() => void loadBoard(b.key, 'refresh', 0)}
              tintColor={colors.accent}
            />
          );
          const openPageNumber = Math.floor(state.offset / PAGE_SIZE) + 1;
          const showOpenPager =
            b.key === 'open' &&
            state.loaded &&
            !state.loading &&
            (state.offset > 0 || state.nextOffset != null);

          return (
            <View key={b.key} style={[styles.page, { width: pageWidth }]}>
              {state.loading && !state.loaded ? (
                <View style={styles.centered}>
                  <ActivityIndicator color={colors.accent} />
                  <LoadingHint label="Loading drives…" />
                </View>
              ) : b.key === 'active' ? (
                <SectionList
                  sections={
                    state.items.length === 0 ? [] : activeSections
                  }
                  keyExtractor={(item) => item.id}
                  stickySectionHeadersEnabled={false}
                  initialNumToRender={10}
                  windowSize={7}
                  removeClippedSubviews={
                    Platform.OS === 'android' ? true : undefined
                  }
                  contentContainerStyle={[
                    styles.listContent,
                    { paddingBottom: padBottom },
                    state.items.length === 0 && styles.listEmptyGrow,
                  ]}
                  showsVerticalScrollIndicator={false}
                  refreshControl={refresh}
                  ListEmptyComponent={listEmpty(b, state)}
                  ListHeaderComponent={
                    pickupError || cancelError ? (
                      <Text style={styles.applyError} accessibilityRole="alert">
                        {pickupError ?? cancelError}
                      </Text>
                    ) : null
                  }
                  renderSectionHeader={({ section }) => (
                    <View
                      style={[
                        styles.sectionHeader,
                        section.key === 'my_drives' &&
                          styles.sectionHeaderFollow,
                      ]}
                    >
                      <Text style={styles.sectionTitle}>{section.title}</Text>
                      {section.data.length === 0 ? (
                        <Text style={styles.sectionEmpty}>
                          {section.key === 'dispatched'
                            ? 'Nothing you’ve dispatched.'
                            : 'No drives assigned to you.'}
                        </Text>
                      ) : null}
                    </View>
                  )}
                  renderItem={({ item, section }) =>
                    renderDriveCard(item, 'active', {
                      showMap: section.key === 'dispatched',
                    })
                  }
                  ItemSeparatorComponent={BoardListSeparator}
                />
              ) : (
                <FlatList
                  data={state.items}
                  keyExtractor={(item) => item.id}
                  initialNumToRender={10}
                  windowSize={7}
                  removeClippedSubviews={
                    Platform.OS === 'android' ? true : undefined
                  }
                  contentContainerStyle={[
                    styles.listContent,
                    { paddingBottom: padBottom },
                    state.items.length === 0 && styles.listEmptyGrow,
                  ]}
                  showsVerticalScrollIndicator={false}
                  refreshControl={refresh}
                  ListEmptyComponent={listEmpty(b, state)}
                  ListHeaderComponent={
                    b.key === 'open' && applyError ? (
                      <Text style={styles.applyError} accessibilityRole="alert">
                        {applyError.message}
                      </Text>
                    ) : null
                  }
                  ListFooterComponent={
                    showOpenPager ? (
                      <View style={styles.pagePager}>
                        <Text style={styles.pageLabel}>
                          Page {openPageNumber}
                        </Text>
                        <View style={styles.pagerActions}>
                          <Button
                            variant="ghost"
                            disabled={state.pageLoading || state.offset <= 0}
                            onPress={() =>
                              void loadBoard(
                                'open',
                                'page',
                                Math.max(0, state.offset - PAGE_SIZE),
                              )
                            }
                          >
                            Previous
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={
                              state.pageLoading || state.nextOffset == null
                            }
                            loading={state.pageLoading}
                            onPress={() => {
                              if (state.nextOffset != null) {
                                void loadBoard(
                                  'open',
                                  'page',
                                  state.nextOffset,
                                );
                              }
                            }}
                          >
                            Next page
                          </Button>
                        </View>
                      </View>
                    ) : null
                  }
                  renderItem={({ item }) => renderDriveCard(item, b.key)}
                  ItemSeparatorComponent={BoardListSeparator}
                />
              )}
            </View>
          );
        })}
      </Animated.ScrollView>

      <CompleteDriveModal
        visible={completingDrive != null}
        drive={completingDrive}
        onClose={() => setCompletingDrive(null)}
        onCompleted={onDriveCompleted}
      />
      <IncomingJobModal
        visible={incomingOffer != null}
        drive={incomingOffer}
        onClose={() => setIncomingOffer(null)}
        onAccepted={() => {
          setIncomingOffer(null);
          void loadBoard('active', 'refresh');
          void pollOffers();
        }}
        onDeclined={() => {
          setIncomingOffer(null);
          void pollOffers();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    marginBottom: space.lg,
    gap: space.md,
  },
  presenceBlock: {
    gap: space.sm,
  },
  presenceLabel: {
    ...type.label,
    color: colors.muted,
    textTransform: 'uppercase',
    paddingLeft: space.xs,
  },
  presenceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  statusChip: {
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
  statusChipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentMuted,
  },
  statusChipDisabled: {
    opacity: 0.55,
  },
  statusChipLabel: {
    ...type.label,
    fontFamily: fonts.sansMedium,
    color: colors.muted,
  },
  statusChipLabelActive: {
    color: colors.ink,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  pill: {
    borderRadius: radius.xl,
  },
  pillInner: {
    padding: 4,
  },
  segments: {
    flexDirection: 'row',
    alignItems: 'stretch',
    position: 'relative',
  },
  thumb: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: radius.lg,
    backgroundColor: colors.accentSoft,
  },
  segment: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.sm + 2,
    borderRadius: radius.lg,
    zIndex: 1,
  },
  segmentFlex: {
    flex: 1,
  },
  segmentLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    letterSpacing: 0.2,
    color: colors.faint,
    textAlign: 'center',
    alignSelf: 'stretch',
  },
  segmentLabelOn: {
    color: colors.ink,
  },
  pager: {
    flex: 1,
  },
  page: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: space.xl,
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
  },
  listEmptyGrow: {
    flexGrow: 1,
  },
  sep: {
    height: space.md,
  },
  sectionHeader: {
    gap: space.xs,
    paddingBottom: space.sm,
  },
  sectionHeaderFollow: {
    paddingTop: space.md,
  },
  sectionTitle: {
    ...type.label,
    color: colors.faint,
    textTransform: 'uppercase',
    paddingLeft: space.xs,
  },
  sectionEmpty: {
    ...type.caption,
    color: colors.muted,
    paddingLeft: space.xs,
    paddingBottom: space.xs,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    paddingHorizontal: space.xl,
  },
  empty: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: space.sm,
    paddingTop: space.xxxl,
    paddingHorizontal: space.xs,
  },
  emptyTitle: {
    ...type.title,
    color: colors.ink,
    textAlign: 'center',
  },
  emptyBody: {
    ...type.body,
    color: colors.muted,
    maxWidth: 280,
    textAlign: 'center',
  },
  applyError: {
    ...type.caption,
    color: colors.danger,
    marginBottom: space.md,
    paddingHorizontal: space.xs,
  },
  pagePager: {
    gap: space.sm,
    paddingTop: space.lg,
    paddingBottom: space.xs,
  },
  pageLabel: {
    ...type.caption,
    color: colors.muted,
    textAlign: 'center',
  },
  pagerActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: space.sm,
  },
});

/** Stable FlatList / SectionList separator — avoids remounting on parent re-render. */
function BoardListSeparator() {
  return <View style={styles.sep} />;
}