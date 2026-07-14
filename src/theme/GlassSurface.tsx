import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import {
  Platform,
  StyleSheet,
  View,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

import { blur, colors, elevation, radius } from './tokens';

type GlassSurfaceProps = ViewProps & {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  /** Soft translucent fill without blur */
  flat?: boolean;
  intensity?: number;
};

/**
 * Liquid glass panel — frosted sheet for auth, bars, modals.
 */
export function GlassSurface({
  children,
  style,
  contentStyle,
  flat = false,
  intensity = blur.glass,
  ...rest
}: GlassSurfaceProps) {
  const useFlat = flat || Platform.OS === 'web';

  return (
    <View style={[styles.base, elevation.glass, style]} {...rest}>
      {useFlat ? (
        <View style={[StyleSheet.absoluteFill, styles.flatFill]} />
      ) : (
        <BlurView
          intensity={intensity}
          tint={blur.tint}
          style={StyleSheet.absoluteFill}
          {...(Platform.OS === 'android'
            ? { experimentalBlurMethod: 'dimezisBlurView' as const }
            : null)}
        />
      )}

      <View style={styles.glassWash} pointerEvents="none" />
      <LinearGradient
        colors={[colors.glassHighlight, 'transparent', 'rgba(0,0,0,0.12)']}
        locations={[0, 0.35, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.sheen}
        pointerEvents="none"
      />
      <View style={[styles.content, contentStyle]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    overflow: 'hidden',
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  flatFill: {
    backgroundColor: colors.glassStrong,
  },
  glassWash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.glass,
  },
  sheen: {
    ...StyleSheet.absoluteFillObject,
  },
  content: {
    zIndex: 1,
  },
});
