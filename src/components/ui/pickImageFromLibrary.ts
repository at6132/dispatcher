import {
  manipulateAsync,
  SaveFormat,
  type Action,
} from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

/** Longest edge — enough for PFP / vehicle thumbs, small enough for Catskills uploads. */
const MAX_EDGE = 1280;
const COMPRESS = 0.72;

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

function resizeActions(
  width: number | undefined,
  height: number | undefined,
): Action[] {
  const w = width ?? 0;
  const h = height ?? 0;
  const longest = Math.max(w, h);
  if (longest <= MAX_EDGE || w < 1 || h < 1) return [];
  return w >= h
    ? [{ resize: { width: MAX_EDGE } }]
    : [{ resize: { height: MAX_EDGE } }];
}

/**
 * Scale down oversized library picks and re-encode as WebP (JPEG fallback).
 * Always re-encodes so HEIC / huge camera rolls stay upload-friendly.
 */
async function optimizePickedImage(
  asset: ImagePicker.ImagePickerAsset,
): Promise<string> {
  const actions = resizeActions(asset.width, asset.height);
  try {
    const webp = await manipulateAsync(asset.uri, actions, {
      compress: COMPRESS,
      format: SaveFormat.WEBP,
    });
    return webp.uri;
  } catch {
    try {
      const jpeg = await manipulateAsync(asset.uri, actions, {
        compress: COMPRESS,
        format: SaveFormat.JPEG,
      });
      return jpeg.uri;
    } catch {
      return asset.uri;
    }
  }
}

/**
 * Opens the system photo library and returns a local URI, or undefined if canceled.
 * Self / interior / exterior (and payment proof) all go through here.
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
      // Full fidelity from picker — we compress in optimizePickedImage.
      quality: 1,
      exif: false,
    });

    if (result.canceled || !result.assets[0]?.uri) return undefined;
    return optimizePickedImage(result.assets[0]);
  });
}
