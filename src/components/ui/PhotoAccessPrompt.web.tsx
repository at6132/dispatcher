import { useEffect } from 'react';

export type PhotoAccessState = 'unknown' | 'blocked' | 'limited' | 'all';

export function photoAccessFromPermission(): PhotoAccessState {
  return 'all';
}

type Props = {
  onAccessChange?: (state: PhotoAccessState) => void;
};

/** Web picks via ImagePicker / file input — no MediaLibrary permission gate. */
export function PhotoAccessPrompt({ onAccessChange }: Props) {
  useEffect(() => {
    onAccessChange?.('all');
  }, [onAccessChange]);

  return null;
}
