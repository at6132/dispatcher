import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
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
  listDrives,
  markDrivePickedUp,
  requestDriveCancel,
  type Drive,
  type DriveBoard,
  type DriveListItem,
} from '../api/drives';
import { mapApiError } from '../api/errors';
import { useAuth } from '../auth/AuthContext';
import { bottomNavClearance } from '../components/navigation/BottomNav';
import { Button } from '../components/ui/Button';
import { CompleteDriveModal } from '../components/ui/CompleteDriveModal';
import { DriveCard } from '../components/ui/DriveCard';
import { getCachedCoordinate } from '../components/ui/getCachedCoordinate';
import { LoadingHint } from '../components/ui/LoadingHint';
import { driverMatchesOpenDrive } from '../drives/matchDrive';
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

type BoardState = {
  items: DriveListItem[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  loaded: boolean;
};

const emptyBoard = (): BoardState => ({
  items: [],
  loading: false,
  refreshing: false,
  error: null,
  loaded: false,
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
  const { user } = useAuth();
  const pagerRef = useRef<Animated.ScrollView>(null);
  const { width: pageWidth } = useWindowDimensions();
  const scrollX = useRef(new Animated.Value(0)).current;
  const indexRef = useRef(0);
  const [index, setIndex] = useState(0);
  const [trackWidth, setTrackWidth] = useState(0);
  const [boards, setBoards] = useState<Record<DriveBoard, BoardState>>({
    open: emptyBoard(),
    active: emptyBoard(),
    history: emptyBoard(),
  });
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [appliedIds, setAppliedIds] = useState<Set<string>>(() => new Set());
  const applyingIdsRef = useRef<Set<string>>(new Set());
  const [applyError, setApplyError] = useState<string | null>(null);
  const [completingDrive, setCompletingDrive] = useState<DriveListItem | null>(
    null,
  );
  const [pickingUpId, setPickingUpId] = useState<string | null>(null);
  const [pickupError, setPickupError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const loadBoard = useCallback(
    async (board: DriveBoard, mode: 'initial' | 'refresh' = 'initial') => {
      setBoards((prev) => ({
        ...prev,
        [board]: {
          ...prev[board],
          loading: mode === 'initial' && !prev[board].loaded,
          refreshing: mode === 'refresh',
          error: null,
        },
      }));
      try {
        const result = await listDrives(board, { limit: 50 });
        const capacity = user?.onboarding
          ? {
              vehicleClass: user.onboarding.vehicleClass,
              seats: user.onboarding.seats,
            }
          : null;
        const items =
          board === 'open'
            ? result.items
                .filter(
                  (d) =>
                    d.status === 'open' &&
                    driverMatchesOpenDrive(capacity, d, user?.id),
                )
                .slice()
                .sort((a, b) => {
                  const fav =
                    Number(Boolean(b.posterIsFavorite)) -
                    Number(Boolean(a.posterIsFavorite));
                  if (fav !== 0) return fav;
                  return b.createdAt.localeCompare(a.createdAt);
                })
            : result.items;
        setBoards((prev) => ({
          ...prev,
          [board]: {
            items,
            loading: false,
            refreshing: false,
            error: null,
            loaded: true,
          },
        }));
        if (board === 'open') {
          // Only clear local “Applied” when the server says cleared/rejected.
          // Do not wipe on null — a stale in-flight refresh can land after
          // apply and would flip Applied back to Apply.
          setAppliedIds((prev) => {
            const next = new Set(prev);
            for (const item of items) {
              const status = item.viewerApplicationStatus;
              if (status === 'pending' || status === 'accepted') {
                next.add(item.id);
              } else if (status === 'cleared' || status === 'rejected') {
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
            error: mapApiError(err).message,
            loaded: prev[board].loaded,
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
    pagerRef.current?.scrollTo({ x: clamped * pageWidth, animated: true });
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

  // Keep stretch visually centered on the moving segment as scale grows.
  const thumbX =
    segmentWidth > 0
      ? Animated.subtract(
          thumbTranslate,
          Animated.multiply(Animated.subtract(thumbScaleX, 1), segmentWidth / 2),
        )
      : thumbTranslate;

  const markApplied = (driveId: string) => {
    setAppliedIds((prev) => new Set(prev).add(driveId));
    setBoards((prev) => ({
      ...prev,
      open: {
        ...prev.open,
        items: prev.open.items.map((d) =>
          d.id === driveId
            ? { ...d, viewerApplicationStatus: 'pending' as const }
            : d,
        ),
      },
    }));
  };

  const onApply = async (driveId: string) => {
    if (applyingIdsRef.current.has(driveId)) return;
    applyingIdsRef.current.add(driveId);
    setApplyError(null);
    setApplyingId(driveId);
    // Optimistic — Applied must not wait on GPS / network, and must not
    // bounce back if a stale board refresh finishes mid-request.
    markApplied(driveId);
    try {
      const coords = await getCachedCoordinate();
      await applyToDrive(driveId, coords ?? undefined);
    } catch (err) {
      const mapped = mapApiError(err);
      if (mapped.code === 'already_applied') {
        markApplied(driveId);
      } else {
        setAppliedIds((prev) => {
          const next = new Set(prev);
          next.delete(driveId);
          return next;
        });
        setBoards((prev) => ({
          ...prev,
          open: {
            ...prev.open,
            items: prev.open.items.map((d) =>
              d.id === driveId
                ? { ...d, viewerApplicationStatus: undefined }
                : d,
            ),
          },
        }));
        setApplyError(mapped.message);
      }
    } finally {
      applyingIdsRef.current.delete(driveId);
      setApplyingId(null);
    }
  };

  const onPickedUp = async (driveId: string) => {
    setPickupError(null);
    setPickingUpId(driveId);
    try {
      const updated = await markDrivePickedUp(driveId);
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
  };

  const onRequestCancel = (driveId: string) => {
    Alert.alert(
      'Cancel this ride?',
      'The dispatcher will get a notification and must approve before the ride is cancelled.',
      [
        { text: 'Keep ride', style: 'cancel' },
        {
          text: 'Request cancel',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setCancelError(null);
              setCancellingId(driveId);
              try {
                const updated = await requestDriveCancel(driveId);
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
          },
        },
      ],
    );
  };

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

  const renderDriveCard = (
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
    const canApply =
      board === 'open' && !applied && status !== 'rejected';
    return (
      <DriveCard
        drive={item}
        viewerId={user?.id}
        onApply={canApply ? () => void onApply(item.id) : undefined}
        onManage={
          onManageDrive != null &&
          (board === 'open' ||
            ((board === 'active' || board === 'history') &&
              user?.id != null &&
              item.posterId === user.id))
            ? () => onManageDrive(item)
            : undefined
        }
        onPickedUp={
          board === 'active' ? () => void onPickedUp(item.id) : undefined
        }
        onComplete={
          board === 'active' ? () => setCompletingDrive(item) : undefined
        }
        onRequestCancel={
          board === 'active' ? () => onRequestCancel(item.id) : undefined
        }
        applying={applyingId === item.id}
        applied={applied}
        pickingUp={pickingUpId === item.id}
        cancelling={cancellingId === item.id}
        applyAgain={applyAgain}
        showMap={opts?.showMap}
      />
    );
  };

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
            // Room for the floating profile PFP (40px) + gap
            paddingRight: space.xl + 40 + space.md,
          },
        ]}
      >
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
                      { translateX: thumbX },
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
                  style={styles.segment}
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
              onRefresh={() => void loadBoard(b.key, 'refresh')}
              tintColor={colors.accent}
            />
          );

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
                  ItemSeparatorComponent={() => <View style={styles.sep} />}
                />
              ) : (
                <FlatList
                  data={state.items}
                  keyExtractor={(item) => item.id}
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
                        {applyError}
                      </Text>
                    ) : null
                  }
                  renderItem={({ item }) => renderDriveCard(item, b.key)}
                  ItemSeparatorComponent={() => <View style={styles.sep} />}
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
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.sm + 2,
    borderRadius: radius.lg,
    zIndex: 1,
  },
  segmentLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    letterSpacing: 0.2,
    color: colors.faint,
  },
  segmentLabelOn: {
    color: colors.ink,
    fontFamily: fonts.sansSemi,
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
    gap: space.sm,
    paddingBottom: space.md,
  },
  sectionHeaderFollow: {
    paddingTop: space.xxl,
  },
  sectionTitle: {
    fontFamily: fonts.sansSemi,
    fontSize: 16,
    letterSpacing: 0.6,
    lineHeight: 22,
    color: colors.muted,
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
    gap: space.sm,
    paddingTop: space.xxxl,
    paddingHorizontal: space.xs,
  },
  emptyTitle: {
    ...type.title,
    color: colors.ink,
  },
  emptyBody: {
    ...type.body,
    color: colors.muted,
    maxWidth: 280,
  },
  applyError: {
    ...type.caption,
    color: colors.danger,
    marginBottom: space.md,
    paddingHorizontal: space.xs,
  },
});
