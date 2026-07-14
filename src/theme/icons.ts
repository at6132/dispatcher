/**
 * Lucide is the app icon pack — quiet stroke weight across chrome + lists.
 * Import icons from `lucide-react-native`; prefer this size/stroke scale.
 */

export const iconStroke = 1.75;

export const iconSize = {
  sm: 16,
  md: 20,
  lg: 24,
  xl: 28,
  /** Tab side icons (Home / Bank) */
  nav: 22,
  /** Center FAB plus glyph (inside steel circle) */
  fab: 52,
} as const;

export type IconSizeToken = keyof typeof iconSize;
