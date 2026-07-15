import { useRef, useState } from 'react';
import {
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import MaskedView from '@react-native-masked-view/masked-view';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { Home, Landmark, Plus } from 'lucide-react-native';

import { Icon } from '../ui/Icon';
import { blur, colors, fonts, motion, space, type } from '../../theme';
import {
  dockCanvasHeight,
  dockCircleCenterY,
  dockSilhouettePath,
  type DockGeom,
} from './dockPath';

export type MainTab = 'home' | 'bank';

type BottomNavProps = {
  active: MainTab;
  onChange: (tab: MainTab) => void;
  onAddPress?: () => void;
};

/**
 * Compact organic dock — glass hugs Home · + · Bank (minimal empty chrome).
 */
const FACE = 96;
/** Thin rim around the plus — just enough to read the hug. */
const RIM = 6;
const MID_H = FACE + RIM * 2;
/** End band tight to the tab content. */
const END_H = 52;
const PLUS = 52;
const BAR_HEIGHT = END_H;
/** Gap between plus edge and Home / Bank. */
const FACE_GAP = 4;
const TAB_W = 60;
/** Glass past the outer tabs. */
const SIDE_PAD = 8;
const DOCK_W =
  SIDE_PAD + TAB_W + FACE + FACE_GAP * 2 + TAB_W + SIDE_PAD;

const GEOM: DockGeom = {
  midH: MID_H,
  endH: END_H,
};

const DOCK_H = dockCanvasHeight(GEOM);
const CIRCLE_CY = dockCircleCenterY(GEOM);

/**
 * Floating dock — one continuous glass blob: Home · + · Bank.
 */
export function BottomNav({ active, onChange, onAddPress }: BottomNavProps) {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, space.sm);
  const [width, setWidth] = useState(0);

  const onLayout = (e: LayoutChangeEvent) => {
    const next = Math.round(e.nativeEvent.layout.width);
    if (next > 0 && next !== width) setWidth(next);
  };

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { paddingBottom: bottomPad }]}
    >
      <View style={styles.dock} onLayout={onLayout}>
        {width > 0 ? (
          <View style={styles.silhouette} pointerEvents="none">
            <DockGlass width={width} />
          </View>
        ) : null}

        {/* Tabs sit on the hug center-line; spacer keeps room for the face */}
        <View
          pointerEvents="box-none"
          style={[styles.row, { top: CIRCLE_CY - BAR_HEIGHT / 2 }]}
        >
          <NavItem
            label="Home"
            active={active === 'home'}
            onPress={() => onChange('home')}
            icon={Home}
          />
          <View style={styles.faceSpacer} />
          <NavItem
            label="Bank"
            active={active === 'bank'}
            onPress={() => onChange('bank')}
            icon={Landmark}
          />
        </View>

        {/* Plus — exact center of the glass hug circle */}
        <View
          pointerEvents="box-none"
          style={[styles.faceLayer, { top: CIRCLE_CY - FACE / 2 }]}
        >
          <AddButton onPress={onAddPress} />
        </View>
      </View>
    </View>
  );
}

function DockGlass({ width }: { width: number }) {
  const height = DOCK_H;
  const d = dockSilhouettePath(width, GEOM);
  const useFlat = Platform.OS === 'web';

  const fill = (
    <>
      {useFlat ? (
        <View style={[StyleSheet.absoluteFill, styles.flatFill]} />
      ) : (
        <BlurView
          intensity={56}
          tint={blur.tint}
          style={StyleSheet.absoluteFill}
          {...(Platform.OS === 'android'
            ? { experimentalBlurMethod: 'dimezisBlurView' as const }
            : null)}
        />
      )}
      <View style={[StyleSheet.absoluteFill, styles.wash]} />
      <LinearGradient
        colors={[colors.glassHighlight, 'transparent', 'rgba(0,0,0,0.14)']}
        locations={[0, 0.4, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </>
  );

  return (
    <View style={{ width, height }}>
      <View style={styles.shadowHost}>
        <Svg width={width} height={height}>
          <Path d={d} fill="rgba(0,0,0,0.35)" />
        </Svg>
      </View>

      {useFlat ? (
        <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
          <Path
            d={d}
            fill={colors.glassStrong}
            stroke={colors.glassBorder}
            strokeWidth={StyleSheet.hairlineWidth * 2}
          />
        </Svg>
      ) : (
        <MaskedView
          style={StyleSheet.absoluteFill}
          maskElement={
            <Svg width={width} height={height}>
              <Path d={d} fill="#ffffff" />
            </Svg>
          }
        >
          <View style={{ width, height }}>{fill}</View>
        </MaskedView>
      )}

      <Svg
        width={width}
        height={height}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      >
        <Path
          d={d}
          fill="transparent"
          stroke={colors.glassBorder}
          strokeWidth={StyleSheet.hairlineWidth * 2}
        />
      </Svg>
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
          size={24}
          color={active ? colors.ink : colors.muted}
          strokeWidth={active ? 2 : 1.7}
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

function AddButton({ onPress }: { onPress?: () => void }) {
  const scale = useRef(new Animated.Value(1)).current;

  const animateTo = (value: number) => {
    Animated.timing(scale, {
      toValue: value,
      duration: motion.durationFast,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add"
        onPress={onPress}
        onPressIn={() => animateTo(motion.pressScale)}
        onPressOut={() => animateTo(1)}
        style={({ pressed }) => [styles.face, pressed && styles.facePressed]}
        hitSlop={4}
      >
        <Icon
          icon={Plus}
          size={PLUS}
          color={colors.onAccent}
          strokeWidth={2.6}
        />
      </Pressable>
    </Animated.View>
  );
}

/** Space so scroll content clears the dock. */
export function bottomNavClearance(bottomInset: number) {
  const pad = Math.max(bottomInset, space.sm);
  return pad + DOCK_H + space.lg;
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: space.md,
    alignItems: 'center',
  },
  dock: {
    width: DOCK_W,
    height: DOCK_H,
  },
  silhouette: {
    ...StyleSheet.absoluteFillObject,
  },
  shadowHost: {
    ...StyleSheet.absoluteFillObject,
    transform: [{ translateY: 4 }],
    opacity: 0.4,
  },
  flatFill: {
    backgroundColor: colors.glassStrong,
  },
  wash: {
    backgroundColor: colors.glass,
  },
  row: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SIDE_PAD,
  },
  item: {
    flexGrow: 0,
    flexShrink: 0,
    width: TAB_W,
  },
  itemPress: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: 2,
    width: '100%',
  },
  itemPressed: {
    opacity: 0.88,
  },
  itemLabel: {
    ...type.label,
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  itemLabelActive: {
    color: colors.ink,
  },
  faceSpacer: {
    width: FACE + FACE_GAP * 2,
  },
  faceLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: FACE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  face: {
    width: FACE,
    height: FACE,
    borderRadius: FACE / 2,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  facePressed: {
    opacity: 0.9,
  },
});
