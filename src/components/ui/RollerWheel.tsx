import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors, fonts, radius, space, type } from '../../theme';

const ITEM_HEIGHT = 44;
const VISIBLE = 5;
/** Softer than "fast" so flings keep coasting after release. */
const DECELERATION = Platform.OS === 'ios' ? 0.998 : 0.985;

type Props = {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  suffix?: string;
  error?: string;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function RollerWheel({
  label,
  value,
  onChange,
  min = 0,
  max = 50,
  suffix = 'years',
  error,
}: Props) {
  const safeMin = Math.max(0, min);
  const safeMax = Math.max(safeMin, max);
  const safeValue = clamp(value, safeMin, safeMax);

  const listRef = useRef<ScrollView>(null);
  const valueRef = useRef(safeValue);
  valueRef.current = safeValue;

  const dragSettleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDragging = useRef(false);

  const items = useMemo(
    () =>
      Array.from({ length: safeMax - safeMin + 1 }, (_, i) => safeMin + i),
    [safeMin, safeMax],
  );

  const padding = ((VISIBLE - 1) / 2) * ITEM_HEIGHT;
  const [centerIndex, setCenterIndex] = useState(safeValue - safeMin);

  const clearDragSettle = () => {
    if (dragSettleTimer.current) {
      clearTimeout(dragSettleTimer.current);
      dragSettleTimer.current = null;
    }
  };

  const indexFromOffset = useCallback(
    (y: number) => {
      const raw = Math.round(y / ITEM_HEIGHT);
      return clamp(raw, 0, items.length - 1);
    },
    [items.length],
  );

  const commitIndex = useCallback(
    (index: number) => {
      const next = clamp(items[index] ?? safeMin, safeMin, safeMax);
      setCenterIndex(index);
      if (next !== valueRef.current) {
        valueRef.current = next;
        onChange(next);
      }
    },
    [items, onChange, safeMax, safeMin],
  );

  const snapToIndex = useCallback(
    (index: number, animated: boolean) => {
      const target = index * ITEM_HEIGHT;
      listRef.current?.scrollTo({ y: target, animated });
      commitIndex(index);
    },
    [commitIndex],
  );

  // Initial position only — value already 0 → no jump.
  useEffect(() => {
    const index = safeValue - safeMin;
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({ y: index * ITEM_HEIGHT, animated: false });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = indexFromOffset(e.nativeEvent.contentOffset.y);
    setCenterIndex((prev) => (prev === index ? prev : index));
  };

  const onScrollBeginDrag = () => {
    Keyboard.dismiss();
    isDragging.current = true;
    clearDragSettle();
  };

  const onScrollEndDrag = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    isDragging.current = false;
    const y = e.nativeEvent.contentOffset.y;
    // If a fling starts, momentum handlers take over. If not, snap after a beat.
    clearDragSettle();
    dragSettleTimer.current = setTimeout(() => {
      dragSettleTimer.current = null;
      if (isDragging.current) return;
      snapToIndex(indexFromOffset(y), true);
    }, 80);
  };

  const onMomentumScrollBegin = () => {
    clearDragSettle();
  };

  const onMomentumScrollEnd = (
    e: NativeSyntheticEvent<NativeScrollEvent>,
  ) => {
    clearDragSettle();
    const index = indexFromOffset(e.nativeEvent.contentOffset.y);
    const y = e.nativeEvent.contentOffset.y;
    const target = index * ITEM_HEIGHT;
    // Native snap usually lands; only nudge if we're slightly off.
    if (Math.abs(y - target) > 1) {
      snapToIndex(index, true);
    } else {
      commitIndex(index);
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.wheel}>
        <View style={styles.selection} pointerEvents="none" />
        <ScrollView
          ref={listRef}
          showsVerticalScrollIndicator={false}
          snapToInterval={ITEM_HEIGHT}
          snapToAlignment="start"
          decelerationRate={DECELERATION}
          bounces
          alwaysBounceVertical={false}
          nestedScrollEnabled
          contentContainerStyle={{ paddingVertical: padding }}
          onScroll={onScroll}
          scrollEventThrottle={16}
          onScrollBeginDrag={onScrollBeginDrag}
          onScrollEndDrag={onScrollEndDrag}
          onMomentumScrollBegin={onMomentumScrollBegin}
          onMomentumScrollEnd={onMomentumScrollEnd}
        >
          {items.map((item, index) => {
            const selected = index === centerIndex;
            return (
              <View key={item} style={styles.item}>
                <Text
                  style={[styles.itemText, selected && styles.itemTextActive]}
                >
                  {item}
                  {selected ? (
                    <Text style={styles.suffix}> {suffix}</Text>
                  ) : null}
                </Text>
              </View>
            );
          })}
        </ScrollView>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space.sm,
  },
  label: {
    ...type.label,
    color: colors.muted,
    textTransform: 'uppercase',
    paddingLeft: space.xs,
  },
  wheel: {
    height: ITEM_HEIGHT * VISIBLE,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    backgroundColor: colors.field,
    overflow: 'hidden',
  },
  selection: {
    position: 'absolute',
    left: space.sm,
    right: space.sm,
    top: ITEM_HEIGHT * ((VISIBLE - 1) / 2),
    height: ITEM_HEIGHT,
    borderRadius: radius.control,
    backgroundColor: colors.accentMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    zIndex: 1,
  },
  item: {
    height: ITEM_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  itemText: {
    fontFamily: fonts.sans,
    fontSize: 18,
    color: colors.faint,
  },
  itemTextActive: {
    fontFamily: fonts.sansSemi,
    fontSize: 22,
    color: colors.ink,
  },
  suffix: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.accent,
  },
  error: {
    ...type.caption,
    color: colors.danger,
    paddingLeft: space.xs,
  },
});
