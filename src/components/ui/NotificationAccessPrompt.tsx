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
import * as Notifications from 'expo-notifications';

import { Button } from './Button';
import { colors, fonts, space, type } from '../../theme';

export type NotificationAccessState =
  | 'unknown'
  | 'blocked'
  | 'denied'
  | 'granted';

export function isNotificationAccessReady(
  access: NotificationAccessState,
): boolean {
  return access === 'granted';
}

export function notificationAccessFromPermissions(
  settings: Notifications.NotificationPermissionsStatus | null,
): NotificationAccessState {
  if (!settings) return 'unknown';

  const iosStatus = settings.ios?.status;
  if (
    settings.granted ||
    iosStatus === Notifications.IosAuthorizationStatus.AUTHORIZED ||
    iosStatus === Notifications.IosAuthorizationStatus.PROVISIONAL ||
    iosStatus === Notifications.IosAuthorizationStatus.EPHEMERAL
  ) {
    return 'granted';
  }

  if (
    settings.status === Notifications.PermissionStatus.DENIED ||
    iosStatus === Notifications.IosAuthorizationStatus.DENIED
  ) {
    return settings.canAskAgain === false ? 'blocked' : 'denied';
  }

  return 'unknown';
}

type Props = {
  onAccessChange?: (state: NotificationAccessState) => void;
};

/**
 * Notification access so drivers hear about accepts, balances, and locks.
 * Optional — can continue without allowing.
 */
export function NotificationAccessPrompt({ onAccessChange }: Props) {
  const [access, setAccess] = useState<NotificationAccessState>('unknown');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const ready = isNotificationAccessReady(access);

  const publish = useCallback(
    (next: NotificationAccessState) => {
      setAccess(next);
      onAccessChange?.(next);
    },
    [onAccessChange],
  );

  const refresh = useCallback(async () => {
    const settings = await Notifications.getPermissionsAsync();
    publish(notificationAccessFromPermissions(settings));
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

  const askForNotifications = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      // Android 13+ won’t show the system prompt until a channel exists.
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'Dispatcher',
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      }

      const settings = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
        },
      });
      const next = notificationAccessFromPermissions(settings);
      publish(next);

      if (next === 'granted') {
        setNote(null);
        return;
      }

      if (next === 'blocked') {
        setNote('Notifications were denied. Open Settings to turn them on.');
        return;
      }

      setNote('Tap again and allow notifications so you don’t miss job updates.');
    } finally {
      setBusy(false);
    }
  }, [publish]);

  if (ready) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Allow notifications</Text>
        <Text style={styles.body}>
          Notifications are on. You’ll hear about jobs and balances even when
          the app isn’t open.
        </Text>
        <Pressable
          disabled
          style={[styles.allowBtn, styles.allowBtnDone]}
          accessibilityRole="button"
          accessibilityState={{ disabled: true, checked: true }}
          accessibilityLabel="Notifications allowed"
        >
          <View style={styles.check}>
            <View style={styles.checkStem} />
            <View style={styles.checkKick} />
          </View>
          <Text style={styles.allowBtnLabelDone}>Notifications allowed</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Allow notifications</Text>
      <Text style={styles.body}>
        Hear about job offers, ride updates, and balances — including when the
        app is closed.
      </Text>
      <Button onPress={() => void askForNotifications()} loading={busy}>
        Allow notifications
      </Button>
      {note ? <Text style={styles.note}>{note}</Text> : null}
      {access === 'blocked' ? (
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
