import { Alert, Platform } from 'react-native';

type ConfirmActionInput = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

/**
 * Native Alert.alert is a no-op on react-native-web (button callbacks never run).
 * Use window.confirm on web; keep Alert on iOS/Android.
 */
export function confirmAction(input: ConfirmActionInput): Promise<boolean> {
  if (Platform.OS === 'web') {
    const text = input.message
      ? `${input.title}\n\n${input.message}`
      : input.title;
    if (typeof globalThis.confirm !== 'function') {
      return Promise.resolve(true);
    }
    return Promise.resolve(globalThis.confirm(text));
  }

  return new Promise((resolve) => {
    Alert.alert(input.title, input.message, [
      {
        text: input.cancelLabel ?? 'Cancel',
        style: 'cancel',
        onPress: () => resolve(false),
      },
      {
        text: input.confirmLabel ?? 'OK',
        style: input.destructive ? 'destructive' : 'default',
        onPress: () => resolve(true),
      },
    ]);
  });
}

/** Info-only alert that actually shows on web. */
export function alertMessage(title: string, message?: string): void {
  if (Platform.OS === 'web') {
    const text = message ? `${title}\n\n${message}` : title;
    if (typeof globalThis.alert === 'function') {
      globalThis.alert(text);
    }
    return;
  }
  Alert.alert(title, message);
}
