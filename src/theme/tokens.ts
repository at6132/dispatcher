/**
 * Dispatcher design profile — liquid glass, low-profile minimal.
 * No logo chrome. Quiet, easy, low texture.
 */

export const colors = {
  // Cool mist canvas — not cream, not purple
  canvas: '#EEF1F5',
  canvasDeep: '#E4E9F0',
  ink: '#1C2128',
  inkSoft: '#3D4550',
  muted: '#6B7380',
  faint: '#9AA3AF',
  // Quiet steel accent — never indigo/violet
  accent: '#3E5A6B',
  accentSoft: 'rgba(62, 90, 107, 0.12)',
  // Glass layers
  glass: 'rgba(255, 255, 255, 0.52)',
  glassStrong: 'rgba(255, 255, 255, 0.72)',
  glassBorder: 'rgba(255, 255, 255, 0.7)',
  glassEdge: 'rgba(28, 33, 40, 0.06)',
  hairline: 'rgba(28, 33, 40, 0.08)',
  danger: '#B54A4A',
  success: '#3D6B55',
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  // Controls stay rounded, never pill-cluster heavy
  control: 12,
} as const;

export const type = {
  display: {
    fontSize: 28,
    fontWeight: '600' as const,
    letterSpacing: -0.4,
    lineHeight: 34,
  },
  title: {
    fontSize: 20,
    fontWeight: '600' as const,
    letterSpacing: -0.2,
    lineHeight: 26,
  },
  body: {
    fontSize: 16,
    fontWeight: '400' as const,
    letterSpacing: 0,
    lineHeight: 24,
  },
  caption: {
    fontSize: 13,
    fontWeight: '400' as const,
    letterSpacing: 0.1,
    lineHeight: 18,
  },
  label: {
    fontSize: 14,
    fontWeight: '500' as const,
    letterSpacing: 0.1,
    lineHeight: 20,
  },
} as const;

/** Soft lift only — no multi-layer glow stacks */
export const elevation = {
  glass: {
    shadowColor: '#1C2128',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 24,
    elevation: 3,
  },
  whisper: {
    shadowColor: '#1C2128',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
} as const;

export const blur = {
  /** Liquid glass panels / bars */
  glass: 42,
  sheet: 58,
  tint: 'systemUltraThinMaterialLight' as const,
} as const;

export const motion = {
  pressScale: 0.98,
  durationFast: 160,
  duration: 240,
} as const;

export const theme = {
  colors,
  space,
  radius,
  type,
  elevation,
  blur,
  motion,
} as const;

export type Theme = typeof theme;
