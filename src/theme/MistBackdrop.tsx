import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';

import { colors } from './tokens';

type MistBackdropProps = ViewProps & {
  children?: ReactNode;
};

/**
 * Atmospheric dusk fog — soft light pools + depth washes.
 * Gradients only; no scattered bubble orbs.
 */
export function MistBackdrop({ children, style, ...rest }: MistBackdropProps) {
  return (
    <View style={[styles.root, style]} {...rest}>
      <LinearGradient
        colors={[colors.canvasDeep, colors.canvas, colors.canvasLift]}
        locations={[0, 0.48, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <LinearGradient
        colors={['transparent', colors.fogSoft, 'transparent']}
        locations={[0.15, 0.45, 0.8]}
        start={{ x: 0, y: 0.2 }}
        end={{ x: 1, y: 0.9 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <LinearGradient
        colors={[colors.fog, 'transparent']}
        locations={[0, 1]}
        start={{ x: 0.3, y: 0 }}
        end={{ x: 0.7, y: 0.55 }}
        style={styles.veil}
        pointerEvents="none"
      />

      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.28)']}
        locations={[0.55, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.canvas,
    overflow: 'hidden',
  },
  veil: {
    position: 'absolute',
    top: -40,
    left: -40,
    right: -40,
    height: '58%',
  },
});
