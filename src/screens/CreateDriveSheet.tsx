import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';

import { createDrive } from '../api/drives';
import { mapApiError } from '../api/errors';
import { useAuth } from '../auth/AuthContext';
import {
  VEHICLE_CLASS_OPTIONS,
  type VehicleClass,
} from '../auth/types';
import {
  formatPhoneDisplay,
  normalizePhone,
  validatePhone,
} from '../auth/validation';
import type { DirectSendTarget } from '../api/profiles';
import { getProfile } from '../api/profiles';
import type { AddOrigin } from '../components/navigation/BottomNav';
import { Button } from '../components/ui/Button';
import { ChoiceGroup } from '../components/ui/ChoiceGroup';
import { DateTimeField } from '../components/ui/DateTimeField';
import { DriverCard } from '../components/ui/DriverCard';
import { Icon } from '../components/ui/Icon';
import { LoadingHint } from '../components/ui/LoadingHint';
import { MapExpandProvider } from '../components/ui/MapExpand';
import { NumberStepper } from '../components/ui/NumberStepper';
import { TextField } from '../components/ui/TextField';
import { MistBackdrop, colors, fonts, space, type } from '../theme';

type CreateDriveSheetProps = {
  visible: boolean;
  origin: AddOrigin | null;
  /** When set, offers the drive directly — they accept or decline. */
  directTo?: DirectSendTarget | null;
  onClose: () => void;
  onCreated: () => void;
};

type TripChoice = 'one_way' | 'round_trip';

const TRIP_OPTIONS: { value: TripChoice; label: string }[] = [
  { value: 'one_way', label: 'One way' },
  { value: 'round_trip', label: 'Round trip' },
];

function isOnline(status: DirectSendTarget['availability']) {
  return status === 'available' || status === 'busy';
}

function mapCoordinate(target: DirectSendTarget | null) {
  if (!target || !isOnline(target.availability)) return null;
  const lat = Number(target.lastLat);
  const lng = Number(target.lastLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { latitude: lat, longitude: lng };
}

function toSendTargetFromProfile(
  item: Awaited<ReturnType<typeof getProfile>>,
  fallback: DirectSendTarget,
): DirectSendTarget {
  const o = item.onboarding;
  const detailParts: string[] = [];
  if (o?.seats != null) detailParts.push(`${o.seats} seats`);
  if (o?.yearsDrivingUpstate != null) {
    detailParts.push(
      `${o.yearsDrivingUpstate} yr${o.yearsDrivingUpstate === 1 ? '' : 's'} upstate`,
    );
  }
  return {
    id: item.id,
    name: item.name || fallback.name,
    availability: item.availability ?? fallback.availability ?? 'offline',
    vehicleType: o?.vehicleType ?? fallback.vehicleType,
    photoUri: o?.selfPhotoUri ?? fallback.photoUri,
    vehicleInteriorUri: o?.vehicleInteriorUri ?? fallback.vehicleInteriorUri,
    vehicleExteriorUri: o?.vehicleExteriorUri ?? fallback.vehicleExteriorUri,
    detail: detailParts.length
      ? detailParts.join(' · ')
      : fallback.detail,
    ...(o?.extraInfo?.trim()
      ? { notes: o.extraInfo.trim() }
      : fallback.notes
        ? { notes: fallback.notes }
        : {}),
    ...(item.lastLat != null
      ? { lastLat: Number(item.lastLat) }
      : fallback.lastLat != null
        ? { lastLat: Number(fallback.lastLat) }
        : {}),
    ...(item.lastLng != null
      ? { lastLng: Number(item.lastLng) }
      : fallback.lastLng != null
        ? { lastLng: Number(fallback.lastLng) }
        : {}),
  };
}

export function CreateDriveSheet({
  visible,
  origin,
  directTo = null,
  onClose,
  onCreated,
}: CreateDriveSheetProps) {
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const { user } = useAuth();
  const [mounted, setMounted] = useState(visible);

  const progress = useRef(new Animated.Value(0)).current;
  const veil = useRef(new Animated.Value(1)).current;

  const [title, setTitle] = useState('');
  const [phone, setPhone] = useState('');
  const [vehicleClass, setVehicleClass] = useState<VehicleClass | null>(
    user?.onboarding?.vehicleClass ?? null,
  );
  const [seats, setSeats] = useState(user?.onboarding?.seats ?? 4);
  const [tripType, setTripType] = useState<TripChoice | null>(null);
  const [scheduledAt, setScheduledAt] = useState(() => new Date());
  const [address, setAddress] = useState('');
  const [extraInfo, setExtraInfo] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [liveTarget, setLiveTarget] = useState<DirectSendTarget | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const originRef = useRef(origin);
  if (visible && origin) originRef.current = origin;

  const morph = useMemo(() => {
    const o = originRef.current;
    const face = o?.width ?? 96;
    return {
      startLeft: o?.x ?? winW / 2 - face / 2,
      startTop: o?.y ?? winH - face - 48,
      startSize: face,
      startRadius: face / 2,
    };
  }, [visible, winW, winH]);

  const resetForm = () => {
    setTitle('');
    setPhone('');
    setVehicleClass(user?.onboarding?.vehicleClass ?? null);
    setSeats(user?.onboarding?.seats ?? 4);
    setTripType(null);
    setScheduledAt(new Date());
    setAddress('');
    setExtraInfo('');
    setSubmitted(false);
    setSubmitting(false);
    setFormError(null);
  };

  useEffect(() => {
    if (visible) {
      setMounted(true);
      progress.setValue(0);
      veil.setValue(1);
      Animated.timing(progress, {
        toValue: 1,
        duration: 380,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
        useNativeDriver: false,
      }).start();
      return;
    }

    if (!mounted) return;
    setMapReady(false);
    // Fade out in place — reversing the layout morph felt choppy on close.
    Animated.timing(veil, {
      toValue: 0,
      duration: 160,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) {
        setMounted(false);
        progress.setValue(0);
        setLiveTarget(null);
        resetForm();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- visibility-driven
  }, [visible]);

  // Fresh location for direct-send — list/seed rows can be stale or missing coords.
  useEffect(() => {
    if (!visible || !directTo?.id) {
      setLiveTarget(null);
      setMapReady(false);
      return;
    }
    const seed = directTo;
    setLiveTarget(seed);
    let cancelled = false;
    const mapTimer = setTimeout(() => {
      if (!cancelled) setMapReady(true);
    }, 480);
    void (async () => {
      try {
        const fresh = await getProfile(seed.id);
        if (cancelled) return;
        setLiveTarget(toSendTargetFromProfile(fresh, seed));
      } catch {
        // Keep the seed target if refresh fails
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(mapTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh when sheet opens for a target
  }, [visible, directTo?.id]);

  const titleError =
    submitted && title.trim().length < 2
      ? 'Enter a title like SF to Monticello'
      : undefined;
  const phoneError = submitted ? validatePhone(phone) : undefined;
  const classError =
    submitted && !vehicleClass ? 'Pick a vehicle class' : undefined;
  const tripError =
    submitted && !tripType ? 'Pick one way or round trip' : undefined;

  const requestClose = () => {
    if (submitting) return;
    Keyboard.dismiss();
    onClose();
  };

  const onSubmit = async () => {
    setSubmitted(true);
    setFormError(null);
    Keyboard.dismiss();

    const phoneIssue = validatePhone(phone);
    if (
      title.trim().length < 2 ||
      phoneIssue ||
      !vehicleClass ||
      !tripType
    ) {
      return;
    }

    setSubmitting(true);
    try {
      await createDrive({
        routeText: title.trim(),
        passengerPhone: normalizePhone(phone),
        vehicleClass,
        seats,
        tripType,
        scheduledAt: scheduledAt.toISOString(),
        ...(address.trim() ? { address: address.trim() } : {}),
        ...(extraInfo.trim() ? { extraInfo: extraInfo.trim() } : {}),
        ...(directTo ? { inviteDriverId: directTo.id } : {}),
      });
      onCreated();
      onClose();
    } catch (err) {
      setFormError(mapApiError(err).message);
      setSubmitting(false);
    }
  };

  const screenOpacity = progress.interpolate({
    inputRange: [0, 0.35, 1],
    outputRange: [0, 1, 1],
  });

  const blobLeft = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [morph.startLeft, 0],
  });
  const blobTop = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [morph.startTop, 0],
  });
  const blobWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [morph.startSize, winW],
  });
  const blobHeight = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [morph.startSize, winH],
  });
  const blobRadius = progress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [morph.startRadius, 24, 0],
  });
  const blobOpacity = progress.interpolate({
    inputRange: [0, 0.45, 0.85],
    outputRange: [1, 0.5, 0],
  });

  const contentOpacity = progress.interpolate({
    inputRange: [0, 0.45, 0.75, 1],
    outputRange: [0, 0, 1, 1],
  });

  if (!mounted) return null;

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      statusBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={requestClose}
    >
      <MapExpandProvider>
      <Animated.View style={[styles.root, { opacity: veil }]}>
        <Animated.View style={[styles.fullScreen, { opacity: screenOpacity }]}>
          <MistBackdrop style={styles.fill} />
        </Animated.View>

        <Animated.View
          pointerEvents="none"
          style={[
            styles.blob,
            {
              left: blobLeft,
              top: blobTop,
              width: blobWidth,
              height: blobHeight,
              borderRadius: blobRadius,
              opacity: blobOpacity,
              backgroundColor: colors.accent,
            },
          ]}
        />

        <Animated.View style={[styles.screen, { opacity: contentOpacity }]}>
          <KeyboardAvoidingView
            style={styles.flex}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={[styles.topBar, { paddingTop: insets.top + space.sm }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={12}
                disabled={submitting}
                onPress={requestClose}
                style={({ pressed }) => [
                  styles.closeBtn,
                  pressed && styles.closeBtnPressed,
                  submitting && styles.closeBtnDisabled,
                ]}
              >
                <Icon icon={X} size="md" color={colors.inkSoft} />
              </Pressable>
            </View>

            <ScrollView
              style={styles.flex}
              contentContainerStyle={[
                styles.form,
                {
                  paddingBottom: insets.bottom + space.xxl,
                },
              ]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Pressable onPress={Keyboard.dismiss} accessible={false}>
                <View style={styles.hero}>
                  <Text style={styles.lead}>
                    {directTo ? 'Send ' : 'Add '}
                  </Text>
                  <Text style={styles.trail}>
                    {directTo ? 'directly' : 'drive'}
                  </Text>
                </View>
                <Text style={styles.support}>
                  {directTo
                    ? `To ${directTo.name}. They get a popup with full details — accept or decline.`
                    : 'Post to the open board for drivers nearby.'}
                </Text>

                {directTo ? (
                  <View style={styles.directPreview}>
                    <DriverCard
                      name={(liveTarget ?? directTo).name}
                      vehicleType={(liveTarget ?? directTo).vehicleType}
                      detail={[
                        (liveTarget ?? directTo).availability
                          ? (liveTarget ?? directTo).availability ===
                            'available'
                            ? 'Available'
                            : (liveTarget ?? directTo).availability === 'busy'
                              ? 'Busy'
                              : 'Offline'
                          : null,
                        (liveTarget ?? directTo).detail,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                      notes={(liveTarget ?? directTo).notes}
                      photoUri={(liveTarget ?? directTo).photoUri}
                      vehicleInteriorUri={
                        (liveTarget ?? directTo).vehicleInteriorUri
                      }
                      vehicleExteriorUri={
                        (liveTarget ?? directTo).vehicleExteriorUri
                      }
                      coordinate={
                        mapReady
                          ? mapCoordinate(liveTarget ?? directTo)
                          : null
                      }
                      showMap={isOnline(
                        (liveTarget ?? directTo).availability,
                      )}
                      availability={
                        (liveTarget ?? directTo).availability ?? 'offline'
                      }
                    />
                  </View>
                ) : null}

                <View style={styles.fields}>
                  <TextField
                    label="Title"
                    value={title}
                    onChangeText={setTitle}
                    placeholder="SF to Monticello"
                    autoCapitalize="words"
                    error={titleError}
                    editable={!submitting}
                    returnKeyType="next"
                  />
                  <TextField
                    label="Customer phone"
                    value={formatPhoneDisplay(phone)}
                    onChangeText={(v) => setPhone(formatPhoneDisplay(v))}
                    keyboardType="phone-pad"
                    error={phoneError}
                    editable={!submitting}
                    textContentType="telephoneNumber"
                  />
                  <ChoiceGroup
                    label="Vehicle class"
                    options={VEHICLE_CLASS_OPTIONS}
                    value={vehicleClass}
                    onChange={setVehicleClass}
                    error={classError}
                  />
                  <NumberStepper
                    label="Seats"
                    hint="Passenger seats needed"
                    value={seats}
                    min={1}
                    max={20}
                    onChange={setSeats}
                  />
                  <ChoiceGroup
                    label="Trip"
                    options={TRIP_OPTIONS}
                    value={tripType}
                    onChange={setTripType}
                    error={tripError}
                  />
                  <DateTimeField
                    label="When"
                    value={scheduledAt}
                    onChange={setScheduledAt}
                    editable={!submitting}
                  />
                  <TextField
                    label="Address (optional)"
                    value={address}
                    onChangeText={setAddress}
                    placeholder="Pickup or drop-off"
                    autoCapitalize="words"
                    editable={!submitting}
                  />
                  <TextField
                    label="Extra info (optional)"
                    value={extraInfo}
                    onChangeText={setExtraInfo}
                    placeholder="Anything drivers should know"
                    multiline
                    editable={!submitting}
                    style={styles.extraInput}
                  />
                </View>
              </Pressable>

              {formError ? (
                <Text style={styles.formError} accessibilityRole="alert">
                  {formError}
                </Text>
              ) : null}

              <View style={styles.actions}>
                <Button
                  loading={submitting}
                  disabled={submitting}
                  onPress={() => void onSubmit()}
                >
                  {directTo ? `Send to ${directTo.name}` : 'Post drive'}
                </Button>
                {submitting ? (
                  <LoadingHint
                    label={directTo ? 'Sending…' : 'Posting…'}
                  />
                ) : null}
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </Animated.View>
      </Animated.View>
      </MapExpandProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  fullScreen: {
    ...StyleSheet.absoluteFillObject,
  },
  fill: {
    ...StyleSheet.absoluteFillObject,
  },
  blob: {
    position: 'absolute',
  },
  screen: {
    ...StyleSheet.absoluteFillObject,
  },
  topBar: {
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
    alignItems: 'flex-end',
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentMuted,
  },
  closeBtnPressed: {
    opacity: 0.85,
  },
  closeBtnDisabled: {
    opacity: 0.45,
  },
  flex: {
    flex: 1,
  },
  form: {
    paddingHorizontal: space.xl,
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    gap: space.lg,
  },
  hero: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingLeft: space.xs,
  },
  lead: {
    ...type.display,
    color: colors.ink,
  },
  trail: {
    fontFamily: fonts.displayItalic,
    fontSize: 36,
    letterSpacing: -0.6,
    lineHeight: 42,
    color: colors.ink,
  },
  support: {
    ...type.body,
    color: colors.muted,
    paddingLeft: space.xs,
    marginTop: -space.sm,
  },
  directPreview: {
    marginTop: space.md,
  },
  fields: {
    gap: space.lg,
  },
  extraInput: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  actions: {
    gap: space.sm,
    marginTop: space.sm,
  },
  formError: {
    ...type.caption,
    color: colors.danger,
    textAlign: 'center',
  },
});
