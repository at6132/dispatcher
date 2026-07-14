/**
 * Dispatcher — mid dusk + atmospheric fog.
 * Cormorant Garamond display + DM Sans UI.
 */

export const fonts = {
  display: 'CormorantGaramond_500Medium',
  displayItalic: 'CormorantGaramond_500Medium_Italic',
  sans: 'DMSans_400Regular',
  sansMedium: 'DMSans_500Medium',
  sansSemi: 'DMSans_600SemiBold',
} as const;

export const colors = {
  canvas: '#252B33',
  canvasDeep: '#1B2026',
  canvasLift: '#323942',
  fog: 'rgba(140, 165, 182, 0.22)',
  fogSoft: 'rgba(180, 200, 214, 0.1)',
  ink: '#EEF1F4',
  inkSoft: '#C8CFD7',
  muted: '#9199A4',
  faint: '#6E7682',
  accent: '#B0C2CC',
  accentSoft: 'rgba(176, 194, 204, 0.18)',
  accentMuted: 'rgba(176, 194, 204, 0.12)',
  onAccent: '#1A1F25',
  glass: 'rgba(255, 255, 255, 0.08)',
  glassStrong: 'rgba(255, 255, 255, 0.12)',
  glassHighlight: 'rgba(255, 255, 255, 0.22)',
  glassBorder: 'rgba(255, 255, 255, 0.16)',
  glassEdge: 'rgba(0, 0, 0, 0.28)',
  hairline: 'rgba(238, 241, 244, 0.14)',
  field: 'rgba(12, 16, 22, 0.32)',
  fieldFocus: 'rgba(12, 16, 22, 0.45)',
  danger: '#D08A8A',
  success: '#7FA894',
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  hero: 56,
} as const;

export const radius = {
  sm: 12,
  md: 16,
  lg: 22,
  xl: 28,
  control: 16,
} as const;

export const type = {
  hero: {
    fontFamily: fonts.display,
    fontSize: 44,
    letterSpacing: -0.8,
    lineHeight: 50,
  },
  heroItalic: {
    fontFamily: fonts.displayItalic,
    fontSize: 44,
    letterSpacing: -0.8,
    lineHeight: 50,
  },
  display: {
    fontFamily: fonts.display,
    fontSize: 36,
    letterSpacing: -0.6,
    lineHeight: 42,
  },
  title: {
    fontFamily: fonts.sansSemi,
    fontSize: 20,
    letterSpacing: -0.3,
    lineHeight: 26,
  },
  body: {
    fontFamily: fonts.sans,
    fontSize: 16,
    letterSpacing: -0.15,
    lineHeight: 24,
  },
  bodyLarge: {
    fontFamily: fonts.sans,
    fontSize: 17,
    letterSpacing: -0.2,
    lineHeight: 26,
  },
  caption: {
    fontFamily: fonts.sans,
    fontSize: 13,
    letterSpacing: 0.1,
    lineHeight: 18,
  },
  label: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    letterSpacing: 0.4,
    lineHeight: 16,
  },
} as const;

export const elevation = {
  glass: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.35,
    shadowRadius: 40,
    elevation: 8,
  },
  whisper: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 16,
    elevation: 3,
  },
} as const;

export const blur = {
  glass: 55,
  sheet: 72,
  tint: 'systemChromeMaterialDark' as const,
} as const;

export const motion = {
  pressScale: 0.985,
  durationFast: 160,
  duration: 240,
  durationSlow: 420,
} as const;

export const theme = {
  fonts,
  colors,
  space,
  radius,
  type,
  elevation,
  blur,
  motion,
} as const;

export type Theme = typeof theme;
