import { useCallback, useEffect, useState } from 'react';
import {
  AppState,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { isRunningInExpoGo } from 'expo';
import * as Location from 'expo-location';

import { Button } from './Button';
import { colors, fonts, space, type } from '../../theme';

export type LocationAccessState =
  | 'unknown'
  | 'blocked'
  | 'whenInUse'
  | 'always';

const inExpoGo = isRunningInExpoGo();

/** True when we have the best access this environment can grant. */
export function isLocationAccessReady(access: LocationAccessState): boolean {
  if (access === 'always') return true;
  // Expo Go cannot expose Always / background location to third-party apps.
  if (access === 'whenInUse' && inExpoGo) return true;
  return false;
}

export function locationAccessFromPermissions(
  foreground: Location.LocationPermissionResponse | null,
  background: Location.LocationPermissionResponse | null,
): LocationAccessState {
  if (!foreground) return 'unknown';
  if (foreground.status !== Location.PermissionStatus.GRANTED) {
    return foreground.status === Location.PermissionStatus.DENIED
      ? 'blocked'
      : 'unknown';
  }

  const iosScope = foreground.ios?.scope ?? background?.ios?.scope;
  if (
    background?.status === Location.PermissionStatus.GRANTED ||
    iosScope === 'always'
  ) {
    return 'always';
  }

  return 'whenInUse';
}

type Props = {
  onAccessChange?: (state: LocationAccessState) => void;
};

/**
 * Location access for matching rides.
 * Always requires a native build — Expo Go only supports While Using.
 */
export function LocationAccessPrompt({ onAccessChange }: Props) {
  const [access, setAccess] = useState<LocationAccessState>('unknown');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const ready = isLocationAccessReady(access);

  const publish = useCallback(
    (next: LocationAccessState) => {
      setAccess(next);
      onAccessChange?.(next);
    },
    [onAccessChange],
  );

  const refresh = useCallback(async () => {
    const [fg, bg] = await Promise.all([
      Location.getForegroundPermissionsAsync(),
      Location.getBackgroundPermissionsAsync(),
    ]);
    publish(locationAccessFromPermissions(fg, bg));
  }, [publish]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Re-check when returning from Settings.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const askForLocation = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      const foreground = await Location.requestForegroundPermissionsAsync();
      if (foreground.status !== Location.PermissionStatus.GRANTED) {
        publish(locationAccessFromPermissions(foreground, null));
        setNote(
          foreground.canAskAgain
            ? 'Location is required. Tap again and allow access.'
            : 'Location was denied. Open Settings and turn location on.',
        );
        return;
      }

      if (inExpoGo) {
        // Always isn’t available in Expo Go — While Using is the max.
        publish(locationAccessFromPermissions(foreground, null));
        setNote(null);
        return;
      }

      const background = await Location.requestBackgroundPermissionsAsync();
      const next = locationAccessFromPermissions(foreground, background);
      publish(next);

      if (next === 'always') {
        setNote(null);
        return;
      }

      if (next === 'whenInUse') {
        setNote(
          Platform.OS === 'ios'
            ? 'Then open Settings → Location and choose Always (only available after a native build requests it).'
            : 'Allow location all the time in Settings so Dispatcher can match you for rides.',
        );
        return;
      }

      setNote('Couldn’t get full location access. Open Settings to allow it.');
    } finally {
      setBusy(false);
    }
  }, [publish]);

  if (ready) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>
          {inExpoGo ? 'Allow location' : 'Allow location · Always'}
        </Text>
        <Text style={styles.body}>
          {inExpoGo
            ? 'Location is on. Always access needs a native build of Dispatcher — Expo Go only supports While Using.'
            : 'Always access is allowed. You can continue.'}
        </Text>
        <Pressable
          disabled
          style={[styles.allowBtn, styles.allowBtnDone]}
          accessibilityRole="button"
          accessibilityState={{ disabled: true, checked: true }}
          accessibilityLabel="Location allowed"
        >
          <View style={styles.check}>
            <View style={styles.checkStem} />
            <View style={styles.checkKick} />
          </View>
          <Text style={styles.allowBtnLabelDone}>Location allowed</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>
        {inExpoGo ? 'Allow location' : 'Allow location · Always'}
      </Text>
      <Text style={styles.body}>
        {inExpoGo
          ? 'Dispatcher needs your location to match rides. In Expo Go, choose While Using — Apple’s Always option isn’t available here.'
          : 'Dispatcher needs your location all the time so rides can find you — even when the app isn’t open. Tap below and choose Allow While Using, then Always when Apple asks.'}
      </Text>
      <Button onPress={() => void askForLocation()} loading={busy}>
        {access === 'whenInUse' && !inExpoGo
          ? 'Upgrade to Always'
          : 'Allow location'}
      </Button>
      {note ? <Text style={styles.note}>{note}</Text> : null}
      {access === 'blocked' || (access === 'whenInUse' && !inExpoGo) ? (
        <Pressable
          onPress={() => void Linking.openSettings()}
          hitSlop={8}
          style={styles.linkWrap}
        >
          <Text style={styles.link}>Open Settings</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space.md,
  },
  title: {
    fontFamily: fonts.sansSemi,
    fontSize: 17,
    color: colors.ink,
  },
  body: {
    ...type.body,
    color: colors.muted,
  },
  note: {
    ...type.caption,
    color: colors.faint,
  },
  linkWrap: {
    alignSelf: 'flex-start',
    paddingVertical: space.xs,
  },
  link: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.accent,
  },
  allowBtn: {
    minHeight: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: space.sm,
    paddingHorizontal: space.lg,
  },
  allowBtnDone: {
    backgroundColor: colors.accentMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  allowBtnLabelDone: {
    fontFamily: fonts.sansSemi,
    fontSize: 16,
    color: colors.success,
  },
  check: {
    width: 14,
    height: 14,
    position: 'relative',
  },
  checkStem: {
    position: 'absolute',
    width: 8,
    height: 1.5,
    backgroundColor: colors.success,
    borderRadius: 1,
    right: 0,
    top: 6,
    transform: [{ rotate: '45deg' }],
  },
  checkKick: {
    position: 'absolute',
    width: 4,
    height: 1.5,
    backgroundColor: colors.success,
    borderRadius: 1,
    left: 1,
    top: 8,
    transform: [{ rotate: '-45deg' }],
  },
});
