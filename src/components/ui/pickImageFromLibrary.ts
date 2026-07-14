import * as ImagePicker from 'expo-image-picker';

/** Serialize library opens — iOS only allows one picker at a time. */
let pickChain: Promise<unknown> = Promise.resolve();

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = pickChain.then(job, job);
  pickChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Opens the system photo library and returns a local URI, or undefined if canceled.
 */
export function pickImageFromLibrary(): Promise<string | undefined> {
  return enqueue(async () => {
    const permission = await ImagePicker.getMediaLibraryPermissionsAsync();
    if (permission.status === 'denied' && !permission.canAskAgain) {
      return undefined;
    }
    if (permission.status !== 'granted') {
      const asked = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!asked.granted) return undefined;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.7,
      exif: false,
    });

    if (result.canceled || !result.assets[0]?.uri) return undefined;
    return result.assets[0].uri;
  });
}
