import { BlurView } from 'expo-blur';
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
  /** Soft translucent fill without blur — use under lists or when blur isn’t available */
  flat?: boolean;
  intensity?: number;
};

/**
 * Low-texture liquid glass panel.
 * Prefer for chrome (bars, sheets, floating controls) — not every content block.
 */
export function GlassSurface({
  children,
  style,
  flat = false,
  intensity = blur.glass,
  ...rest
}: GlassSurfaceProps) {
  if (flat || Platform.OS === 'web') {
    return (
      <View style={[styles.base, styles.flat, style]} {...rest}>
        {children}
      </View>
    );
  }

  return (
    <View style={[styles.base, elevation.glass, style]} {...rest}>
      <BlurView
        intensity={intensity}
        tint={blur.tint}
        style={StyleSheet.absoluteFill}
        {...(Platform.OS === 'android'
          ? { experimentalBlurMethod: 'dimezisBlurView' as const }
          : null)}
      />
      <View style={styles.glassWash} pointerEvents="none" />
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    overflow: 'hidden',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  flat: {
    backgroundColor: colors.glassStrong,
    borderColor: colors.glassEdge,
    ...elevation.whisper,
  },
  glassWash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.glass,
  },
  content: {
    zIndex: 1,
  },
});
