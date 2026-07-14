import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
  type DriveBoard,
  type DriveListItem,
} from '../api/drives';
import { mapApiError } from '../api/errors';
import { useAuth } from '../auth/AuthContext';
import { bottomNavClearance } from '../components/navigation/BottomNav';
import { Button } from '../components/ui/Button';
import { DriveCard } from '../components/ui/DriveCard';
import { LoadingHint } from '../components/ui/LoadingHint';
import { GlassSurface, colors, fonts, radius, space, type } from '../theme';

const BOARDS: {
  key: DriveBoard;
  label: string;
  empty: string;
}[] = [
  { key: 'open', label: 'Open', empty: 'No open drives right now.' },
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
  /** Open board — manage a drive you posted. */
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
  const [applyError, setApplyError] = useState<string | null>(null);

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
        setBoards((prev) => ({
          ...prev,
          [board]: {
            items: result.items,
            loading: false,
            refreshing: false,
            error: null,
            loaded: true,
          },
        }));
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
    [],
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

  const onApply = async (driveId: string) => {
    setApplyError(null);
    setApplyingId(driveId);
    try {
      await applyToDrive(driveId);
      setAppliedIds((prev) => new Set(prev).add(driveId));
    } catch (err) {
      const mapped = mapApiError(err);
      if (mapped.code === 'already_applied') {
        setAppliedIds((prev) => new Set(prev).add(driveId));
      } else {
        setApplyError(mapped.message);
      }
    } finally {
      setApplyingId(null);
    }
  };

  const padBottom = bottomNavClearance(insets.bottom) + space.lg;

  const activeSections = useMemo(
    () => splitActiveSections(boards.active.items, user?.id),
    [boards.active.items, user?.id],
  );

  const renderDriveCard = (item: DriveListItem, board: DriveBoard) => (
    <DriveCard
      drive={item}
      viewerId={user?.id}
      onApply={
        board === 'open' ? () => void onApply(item.id) : undefined
      }
      onManage={
        board === 'open' ? () => onManageDrive?.(item) : undefined
      }
      applying={applyingId === item.id}
      applied={appliedIds.has(item.id)}
    />
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
                  renderItem={({ item }) => renderDriveCard(item, 'active')}
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
