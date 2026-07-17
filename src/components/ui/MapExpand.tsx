import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';

import { colors, fonts, radius, space, type } from '../../theme';
import { Icon } from './Icon';

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

const PREVIEW_DELTA = 0.02;
const EXPANDED_DELTA = 0.035;

/**
 * Host for tap-to-expand maps. Renders an absolute overlay (not a Modal) so it
 * works inside sheets without nested-Modal + MapView freezes.
 */
export function MapExpandProvider({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState<MapExpandPayload | null>(null);
  const insets = useSafeAreaInsets();

  const closeMap = useCallback(() => setExpanded(null), []);
  const expandMap = useCallback((payload: MapExpandPayload) => {
    setExpanded(payload);
  }, []);

  const value = useMemo(
    () => ({ expandMap, closeMap, expanded }),
    [expandMap, closeMap, expanded],
  );

  return (
    <MapExpandContext.Provider value={value}>
      <View style={styles.host} collapsable={false}>
        {children}
        {expanded ? (
          <View style={styles.overlay} accessibilityViewIsModal>
            <MapView
              style={styles.mapFill}
              provider={PROVIDER_DEFAULT}
              showsCompass={false}
              showsPointsOfInterest={false}
              toolbarEnabled={false}
              initialRegion={{
                latitude: expanded.coordinate.latitude,
                longitude: expanded.coordinate.longitude,
                latitudeDelta: EXPANDED_DELTA,
                longitudeDelta: EXPANDED_DELTA,
              }}
            >
              <Marker
                coordinate={expanded.coordinate}
                title={expanded.markerTitle}
              />
            </MapView>

            <View
              style={[styles.top, { paddingTop: insets.top + space.sm }]}
              pointerEvents="box-none"
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close map"
                hitSlop={12}
                onPress={closeMap}
                style={({ pressed }) => [
                  styles.closeBtn,
                  pressed && styles.closeBtnPressed,
                ]}
              >
                <Icon icon={X} size="md" color={colors.ink} />
              </Pressable>
              {expanded.title ? (
                <View style={styles.meta} pointerEvents="none">
                  <Text style={styles.title} numberOfLines={2}>
                    {expanded.title}
                  </Text>
                </View>
              ) : null}
            </View>

            {expanded.subtitle ? (
              <View
                style={[
                  styles.bottom,
                  { paddingBottom: insets.bottom + space.md },
                ]}
                pointerEvents="none"
              >
                <Text style={styles.hint}>{expanded.subtitle}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </MapExpandContext.Provider>
  );
}

export function useMapExpand(): MapExpandContextValue {
  const ctx = useContext(MapExpandContext);
  if (!ctx) {
    throw new Error('useMapExpand requires MapExpandProvider');
  }
  return ctx;
}

/** Soft lookup — preview stays non-expandable when no host is mounted. */
function useMapExpandOptional(): MapExpandContextValue | null {
  return useContext(MapExpandContext);
}

type MapPreviewProps = {
  coordinate: MapCoordinate | null | undefined;
  height: number;
  /** Accessibility / expand payload */
  title?: string;
  subtitle?: string;
  markerTitle?: string;
  /** Badge / chip overlaid on the preview (e.g. drive status) */
  badge?: ReactNode;
  emptyLabel?: string;
  style?: object;
};

/**
 * Static map thumbnail — tap opens the nearest MapExpandProvider overlay.
 */
export function MapPreview({
  coordinate,
  height,
  title,
  subtitle,
  markerTitle,
  badge,
  emptyLabel = 'Waiting for location',
  style,
}: MapPreviewProps) {
  const expand = useMapExpandOptional();
  const isExpandedHere =
    expand?.expanded != null &&
    coordinate != null &&
    expand.expanded.coordinate.latitude === coordinate.latitude &&
    expand.expanded.coordinate.longitude === coordinate.longitude;

  const canExpand = expand != null && coordinate != null;

  return (
    <Pressable
      style={[styles.previewWrap, { height }, style]}
      accessibilityRole={canExpand ? 'button' : undefined}
      accessibilityLabel={
        canExpand
          ? `Expand map${title ? `, ${title}` : ''}`
          : coordinate
            ? title
            : emptyLabel
      }
      disabled={!canExpand}
      onPress={(e) => {
        e.stopPropagation?.();
        if (!coordinate || !expand) return;
        expand.expandMap({
          coordinate,
          title,
          subtitle,
          markerTitle,
        });
      }}
    >
      {coordinate && !isExpandedHere ? (
        <MapView
          key={`${coordinate.latitude},${coordinate.longitude}`}
          style={styles.mapFill}
          provider={PROVIDER_DEFAULT}
          pointerEvents="none"
          scrollEnabled={false}
          zoomEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}
          toolbarEnabled={false}
          showsCompass={false}
          showsPointsOfInterest={false}
          initialRegion={{
            latitude: coordinate.latitude,
            longitude: coordinate.longitude,
            latitudeDelta: PREVIEW_DELTA,
            longitudeDelta: PREVIEW_DELTA,
          }}
        >
          <Marker coordinate={coordinate} />
        </MapView>
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            {coordinate ? 'Open map' : emptyLabel}
          </Text>
        </View>
      )}
      {badge}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
    elevation: 100,
    backgroundColor: colors.canvasDeep,
  },
  mapFill: {
    ...StyleSheet.absoluteFillObject,
  },
  top: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: space.md,
    gap: space.sm,
  },
  closeBtn: {
    alignSelf: 'flex-start',
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(27, 32, 38, 0.78)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  closeBtnPressed: {
    opacity: 0.88,
  },
  meta: {
    paddingHorizontal: space.xs,
  },
  title: {
    fontFamily: fonts.sansSemi,
    fontSize: 17,
    letterSpacing: -0.2,
    lineHeight: 22,
    color: colors.ink,
    textShadowColor: 'rgba(0, 0, 0, 0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  bottom: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    bottom: 0,
  },
  hint: {
    ...type.caption,
    color: colors.inkSoft,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.control,
    overflow: 'hidden',
    backgroundColor: 'rgba(27, 32, 38, 0.78)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    alignSelf: 'flex-start',
  },
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
