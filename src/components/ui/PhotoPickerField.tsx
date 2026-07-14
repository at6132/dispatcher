import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors, fonts, radius, space, type } from '../../theme';
import { pickImageFromLibrary } from './pickImageFromLibrary';

type Variant = 'avatar' | 'rect';

type Props = {
  label: string;
  hint?: string;
  uri?: string;
  onChange: (uri: string | undefined) => void;
  /** avatar = circular profile photo; rect = vehicle / general */
  variant?: Variant;
  compact?: boolean;
};

const CLEAR_SIZE = 26;
const AVATAR_SIZE = 112;

export function PhotoPickerField({
  label,
  hint,
  uri,
  onChange,
  variant = 'rect',
  compact = false,
}: Props) {
  const [opening, setOpening] = useState(false);
  const isAvatar = variant === 'avatar';

  const pick = async () => {
    if (opening) return;
    setOpening(true);
    try {
      const next = await pickImageFromLibrary();
      if (next) onChange(next);
    } finally {
      setOpening(false);
    }
  };

  return (
    <View
      style={[styles.wrap, isAvatar && styles.wrapAvatar]}
      pointerEvents="box-none"
    >
      <Text style={[styles.label, isAvatar && styles.labelCenter]}>{label}</Text>
      {hint ? (
        <Text style={[styles.hint, isAvatar && styles.labelCenter]}>{hint}</Text>
      ) : null}
      <View
        style={[styles.media, isAvatar && styles.mediaAvatar]}
        pointerEvents="box-none"
      >
        <Pressable
          onPress={() => void pick()}
          style={[
            isAvatar ? styles.avatar : styles.frame,
            !isAvatar && compact && styles.frameCompact,
            opening && styles.busy,
          ]}
          accessibilityRole="button"
          accessibilityLabel={uri ? `Change ${label}` : `Add ${label}`}
          accessibilityState={{ busy: opening }}
        >
          {uri ? (
            <Image
              source={{ uri }}
              style={isAvatar ? styles.avatarImage : styles.image}
            />
          ) : (
            <Text style={styles.placeholder}>Add photo</Text>
          )}
          {opening ? (
            <View style={styles.busyOverlay} pointerEvents="none">
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : null}
        </Pressable>
        {uri ? (
          <Pressable
            onPress={() => onChange(undefined)}
            disabled={opening}
            hitSlop={6}
            style={[styles.clear, isAvatar && styles.clearAvatar]}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${label}`}
          >
            <View style={styles.clearIcon} pointerEvents="none">
              <View style={[styles.clearBar, styles.clearBarA]} />
              <View style={[styles.clearBar, styles.clearBarB]} />
            </View>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space.sm,
  },
  wrapAvatar: {
    alignItems: 'center',
  },
  label: {
    ...type.label,
    color: colors.muted,
    textTransform: 'uppercase',
    paddingLeft: space.xs,
  },
  labelCenter: {
    paddingLeft: 0,
    textAlign: 'center',
  },
  hint: {
    ...type.caption,
    color: colors.faint,
    paddingLeft: space.xs,
  },
  media: {
    position: 'relative',
  },
  mediaAvatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
  },
  frame: {
    height: 148,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    backgroundColor: colors.field,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  frameCompact: {
    height: 108,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.field,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  busy: {
    opacity: 0.85,
  },
  busyOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(12, 16, 22, 0.35)',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.accent,
  },
  clear: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: CLEAR_SIZE,
    height: CLEAR_SIZE,
    borderRadius: CLEAR_SIZE / 2,
    backgroundColor: colors.canvasDeep,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  clearAvatar: {
    top: 2,
    right: 2,
  },
  clearIcon: {
    width: 10,
    height: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearBar: {
    position: 'absolute',
    width: 10,
    height: 1.5,
    borderRadius: 1,
    backgroundColor: colors.ink,
  },
  clearBarA: {
    transform: [{ rotate: '45deg' }],
  },
  clearBarB: {
    transform: [{ rotate: '-45deg' }],
  },
});
