import type { LucideIcon, LucideProps } from 'lucide-react-native';

import { colors } from '../../theme/tokens';
import { iconSize, iconStroke, type IconSizeToken } from '../../theme/icons';

type IconProps = Omit<LucideProps, 'size' | 'color' | 'strokeWidth'> & {
  icon: LucideIcon;
  size?: IconSizeToken | number;
  color?: string;
  strokeWidth?: number;
};

/**
 * Thin Lucide wrapper — app-wide stroke + size tokens.
 */
export function Icon({
  icon: Glyph,
  size = 'md',
  color = colors.ink,
  strokeWidth = iconStroke,
  absoluteStrokeWidth = true,
  ...rest
}: IconProps) {
  const resolved = typeof size === 'number' ? size : iconSize[size];

  return (
    <Glyph
      size={resolved}
      color={color}
      strokeWidth={strokeWidth}
      absoluteStrokeWidth={absoluteStrokeWidth}
      {...rest}
    />
  );
}
