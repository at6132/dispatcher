import { useRef } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Home, Landmark, Plus } from 'lucide-react-native';

import { Icon } from '../ui/Icon';
import {
  GlassSurface,
  colors,
  elevation,
  fonts,
  motion,
  radius,
  space,
  type,
} from '../../theme';

export type MainTab = 'home' | 'bank';

type BottomNavProps = {
  active: MainTab;
  onChange: (tab: MainTab) => void;
  onAddPress?: () => void;
};

const BAR_HEIGHT = 64;
const FAB_SIZE = 58;

/**
 * Floating glass dock — Home · massive + · Bank.
 * Glass chrome only; sits over mist, not edge-to-edge.
 */
export function BottomNav({ active, onChange, onAddPress }: BottomNavProps) {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, space.sm);

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { paddingBottom: bottomPad }]}
    >
      <GlassSurface
        style={styles.bar}
        contentStyle={styles.barContent}
        intensity={48}
      >
        <NavItem
          label="Home"
          active={active === 'home'}
          onPress={() => onChange('home')}
          icon={Home}
        />

        <View style={styles.fabSlot}>
          <FabButton onPress={onAddPress} />
        </View>

        <NavItem
          label="Bank"
          active={active === 'bank'}
          onPress={() => onChange('bank')}
          icon={Landmark}
        />
      </GlassSurface>
    </View>
  );
}

type NavItemProps = {
  label: string;
  active: boolean;
  onPress: () => void;
  icon: typeof Home;
};

function NavItem({ label, active, onPress, icon }: NavItemProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const animateTo = (value: number) => {
    Animated.timing(scale, {
      toValue: value,
      duration: motion.durationFast,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View style={[styles.item, { transform: [{ scale }] }]}>
      <Pressable
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        accessibilityLabel={label}
        onPress={onPress}
        onPressIn={() => animateTo(motion.pressScale)}
        onPressOut={() => animateTo(1)}
        style={({ pressed }) => [
          styles.itemPress,
          pressed && styles.itemPressed,
        ]}
        hitSlop={8}
      >
        <Icon
          icon={icon}
          size="nav"
          color={active ? colors.ink : colors.muted}
          strokeWidth={active ? 2 : 1.6}
        />
        <Text
          style={[styles.itemLabel, active ? styles.itemLabelActive : null]}
        >
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

function FabButton({ onPress }: { onPress?: () => void }) {
  const scale = useRef(new Animated.Value(1)).current;

  const animateTo = (value: number) => {
    Animated.timing(scale, {
      toValue: value,
      duration: motion.durationFast,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View style={[styles.fabShadow, { transform: [{ scale }] }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add"
        onPress={onPress}
        onPressIn={() => animateTo(motion.pressScale)}
        onPressOut={() => animateTo(1)}
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
      >
        <Icon icon={Plus} size="fab" color={colors.onAccent} strokeWidth={2.25} />
      </Pressable>
    </Animated.View>
  );
}

/** Space to reserve so scroll content clears the floating dock. */
export function bottomNavClearance(bottomInset: number) {
  const pad = Math.max(bottomInset, space.sm);
  return pad + BAR_HEIGHT + space.md + FAB_SIZE * 0.28;
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space.xl,
    alignItems: 'center',
  },
  bar: {
    width: '100%',
    maxWidth: 400,
    borderRadius: radius.xl + 8,
    ...elevation.whisper,
  },
  barContent: {
    minHeight: BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.sm,
  },
  item: {
    flex: 1,
  },
  itemPress: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: space.sm,
  },
  itemPressed: {
    opacity: 0.88,
  },
  itemLabel: {
    ...type.label,
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    letterSpacing: 0.35,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  itemLabelActive: {
    color: colors.ink,
  },
  fabSlot: {
    width: FAB_SIZE + space.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabShadow: {
    ...elevation.whisper,
  },
  fab: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    marginTop: -(FAB_SIZE * 0.28),
    marginBottom: -(FAB_SIZE * 0.18),
    borderRadius: radius.xl,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassHighlight,
  },
  fabPressed: {
    opacity: 0.92,
  },
});
