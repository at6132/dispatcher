import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, type } from '../../theme';

export type MapCoordinate = {
  latitude: number;
  longitude: number;
};

export type MapExpandPayload = {
  coordinate: MapCoordinate;
  title?: string;
  subtitle?: string;
  markerTitle?: string;
};

type MapExpandContextValue = {
  expandMap: (payload: MapExpandPayload) => void;
  closeMap: () => void;
  expanded: MapExpandPayload | null;
};

const MapExpandContext = createContext<MapExpandContextValue | null>(null);

function mapsUrl(coordinate: MapCoordinate): string {
  return `https://www.google.com/maps?q=${coordinate.latitude},${coordinate.longitude}`;
}

export function MapExpandProvider({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState<MapExpandPayload | null>(null);

  const closeMap = useCallback(() => setExpanded(null), []);
  const expandMap = useCallback((payload: MapExpandPayload) => {
    void Linking.openURL(mapsUrl(payload.coordinate));
    setExpanded(null);
  }, []);

  const value = useMemo(
    () => ({ expandMap, closeMap, expanded }),
    [expandMap, closeMap, expanded],
  );

  return (
    <MapExpandContext.Provider value={value}>{children}</MapExpandContext.Provider>
  );
}

export function useMapExpand(): MapExpandContextValue {
  const ctx = useContext(MapExpandContext);
  if (!ctx) {
    throw new Error('useMapExpand requires MapExpandProvider');
  }
  return ctx;
}

function useMapExpandOptional(): MapExpandContextValue | null {
  return useContext(MapExpandContext);
}

type MapPreviewProps = {
  coordinate: MapCoordinate | null | undefined;
  height: number;
  title?: string;
  subtitle?: string;
  markerTitle?: string;
  badge?: ReactNode;
  emptyLabel?: string;
  style?: object;
};

export function MapPreview({
  coordinate,
  height,
  title,
  emptyLabel = 'Waiting for location',
  badge,
  style,
}: MapPreviewProps) {
  const expand = useMapExpandOptional();
  const canExpand = expand != null && coordinate != null;

  return (
    <Pressable
      style={[styles.previewWrap, { height }, style]}
      accessibilityRole={canExpand ? 'button' : undefined}
      accessibilityLabel={
        canExpand
          ? `Open map${title ? `, ${title}` : ''}`
          : coordinate
            ? title
            : emptyLabel
      }
      disabled={!canExpand}
      onPress={() => {
        if (!coordinate || !expand) return;
        expand.expandMap({ coordinate, title });
      }}
    >
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          {coordinate ? 'Open in Maps' : emptyLabel}
        </Text>
      </View>
      {badge}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  previewWrap: {
    backgroundColor: colors.canvasDeep,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    ...type.caption,
    color: colors.faint,
  },
});
