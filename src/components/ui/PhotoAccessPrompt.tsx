import { useCallback, useEffect, useState } from 'react';
import {
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as MediaLibrary from 'expo-media-library';

import { Button } from './Button';
import { colors, fonts, space, type } from '../../theme';

export type PhotoAccessState = 'unknown' | 'blocked' | 'limited' | 'all';

export function photoAccessFromPermission(
  permission: MediaLibrary.PermissionResponse | null,
): PhotoAccessState {
  if (!permission) return 'unknown';
  if (permission.status === 'denied' || permission.status === 'undetermined') {
    return permission.status === 'denied' ? 'blocked' : 'unknown';
  }
  if (permission.granted) {
    if (permission.accessPrivileges === 'limited') return 'limited';
    return 'all';
  }
  return 'blocked';
}

type Props = {
  onAccessChange?: (state: PhotoAccessState) => void;
};

/**
 * Apple-compliant photo access flow:
 * 1) explain why
 * 2) trigger the system dialog (includes “Allow Access to All Photos”)
 * 3) if limited, offer a path to expand access
 *
 * Web uses PhotoAccessPrompt.web.tsx (browser file picker, no MediaLibrary).
 */
export function PhotoAccessPrompt({ onAccessChange }: Props) {
  const [permission, requestPermission] = MediaLibrary.usePermissions({
    granularPermissions: ['photo'],
  });
  const [busy, setBusy] = useState(false);

  const access = photoAccessFromPermission(permission ?? null);

  useEffect(() => {
    onAccessChange?.(access);
  }, [access, onAccessChange]);

  const askForAccess = useCallback(async () => {
    setBusy(true);
    try {
      const result = await requestPermission();
      onAccessChange?.(photoAccessFromPermission(result));
    } finally {
      setBusy(false);
    }
  }, [onAccessChange, requestPermission]);

  const manageLimitedAccess = useCallback(async () => {
    if (Platform.OS === 'ios') {
      try {
        await MediaLibrary.presentPermissionsPickerAsync(['photo']);
        const next = await MediaLibrary.getPermissionsAsync();
        onAccessChange?.(photoAccessFromPermission(next));
        return;
      } catch {
        // Fall through to Settings if the picker isn’t available.
      }
    }
    await Linking.openSettings();
  }, [onAccessChange]);

  if (access === 'all') return null;

  if (access === 'limited') {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Photo access is limited</Text>
        <Text style={styles.body}>
          You selected only some photos. To let Dispatcher use more — or all —
          photos for your profile and vehicle, update access.
        </Text>
        <Button onPress={() => void manageLimitedAccess()}>
          Allow access to all photos
        </Button>
        <Pressable
          onPress={() => void Linking.openSettings()}
          hitSlop={8}
          style={styles.linkWrap}
        >
          <Text style={styles.link}>Open Settings</Text>
        </Pressable>
      </View>
    );
  }

  if (access === 'blocked') {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Photos are turned off</Text>
        <Text style={styles.body}>
          Enable photo access in Settings so you can add optional pictures of
          yourself and your car.
        </Text>
        <Button onPress={() => void Linking.openSettings()}>
          Open Settings
        </Button>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Allow photo access</Text>
      <Text style={styles.body}>
        Dispatcher uses your photo library so you can optionally add a picture
        of yourself and your car. Choose “Allow Access to All Photos” for the
        easiest experience, or select specific photos.
      </Text>
      <Button
        onPress={() => void askForAccess()}
        loading={busy}
        accessibilityLabel="Allow photo access"
      >
        Continue
      </Button>
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
    letterSpacing: -0.2,
  },
  body: {
    ...type.body,
    color: colors.muted,
  },
  linkWrap: {
    alignSelf: 'center',
    paddingVertical: space.sm,
  },
  link: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.accent,
  },
});
