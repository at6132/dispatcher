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
import type { AddOrigin } from '../components/navigation/BottomNav';
import { Button } from '../components/ui/Button';
import { ChoiceGroup } from '../components/ui/ChoiceGroup';
import { LoadingHint } from '../components/ui/LoadingHint';
import { NumberStepper } from '../components/ui/NumberStepper';
import { TextField } from '../components/ui/TextField';
import { MistBackdrop, colors, fonts, space, type } from '../theme';

type CreateDriveSheetProps = {
  visible: boolean;
  /** Screen coords of the + — circle expands from here. */
  origin: AddOrigin | null;
  onClose: () => void;
  onCreated: () => void;
};

type TripChoice = 'one_way' | 'round_trip';

const TRIP_OPTIONS: { value: TripChoice; label: string }[] = [
  { value: 'one_way', label: 'One way' },
  { value: 'round_trip', label: 'Round trip' },
];

export function CreateDriveSheet({
  visible,
  origin,
  onClose,
  onCreated,
}: CreateDriveSheetProps) {
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const { user } = useAuth();
  const [mounted, setMounted] = useState(visible);

  /** 0 = plus-sized circle · 1 = full reveal */
  const reveal = useRef(new Animated.Value(0)).current;
  /** Content fades after the circle has already covered the screen */
  const content = useRef(new Animated.Value(0)).current;

  const [title, setTitle] = useState('');
  const [phone, setPhone] = useState('');
  const [vehicleClass, setVehicleClass] = useState<VehicleClass | null>(
    user?.onboarding?.vehicleClass ?? null,
  );
  const [seats, setSeats] = useState(user?.onboarding?.seats ?? 4);
  const [tripType, setTripType] = useState<TripChoice | null>(null);
  const [address, setAddress] = useState('');
  const [extraInfo, setExtraInfo] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const originRef = useRef(origin);
  if (visible && origin) originRef.current = origin;

  const geometry = useMemo(() => {
    const o = originRef.current;
    const face = o?.width ?? 96;
    const ox = o ? o.x + o.width / 2 : winW / 2;
    const oy = o ? o.y + o.height / 2 : winH - 80;
    // Big enough that a circle centered on + covers every corner.
    const disc = Math.sqrt(winW * winW + winH * winH) * 1.2;
    return {
      face,
      disc,
      left: ox - disc / 2,
      top: oy - disc / 2,
      startScale: face / disc,
    };
  }, [visible, winW, winH]);

  const resetForm = () => {
    setTitle('');
    setPhone('');
    setVehicleClass(user?.onboarding?.vehicleClass ?? null);
    setSeats(user?.onboarding?.seats ?? 4);
    setTripType(null);
    setAddress('');
    setExtraInfo('');
    setSubmitted(false);
    setSubmitting(false);
    setFormError(null);
  };

  useEffect(() => {
    if (visible) {
      setMounted(true);
      reveal.setValue(0);
      content.setValue(0);

      Animated.sequence([
        Animated.timing(reveal, {
          toValue: 1,
          duration: 480,
          easing: Easing.bezier(0.22, 1, 0.36, 1),
          useNativeDriver: true,
        }),
        Animated.timing(content, {
          toValue: 1,
          duration: 220,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
      return;
    }

    if (!mounted) return;

    Animated.sequence([
      Animated.timing(content, {
        toValue: 0,
        duration: 140,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(reveal, {
        toValue: 0,
        duration: 360,
        easing: Easing.bezier(0.4, 0, 0.7, 0.15),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        setMounted(false);
        resetForm();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- visibility-driven open/close
  }, [visible]);

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
        ...(address.trim() ? { address: address.trim() } : {}),
        ...(extraInfo.trim() ? { extraInfo: extraInfo.trim() } : {}),
      });
      onCreated();
      onClose();
    } catch (err) {
      setFormError(mapApiError(err).message);
      setSubmitting(false);
    }
  };

  // Pure radial grow — no translate of the whole screen (that read as “fly in”).
  const discScale = reveal.interpolate({
    inputRange: [0, 1],
    outputRange: [geometry.startScale, 1],
  });
  const mistOpacity = reveal.interpolate({
    inputRange: [0, 0.35, 0.7, 1],
    outputRange: [0, 0.15, 0.85, 1],
  });
  const steelOpacity = reveal.interpolate({
    inputRange: [0, 0.45, 0.85],
    outputRange: [1, 0.55, 0],
  });
  const contentOpacity = content;
  const contentLift = content.interpolate({
    inputRange: [0, 1],
    outputRange: [14, 0],
  });

  if (!mounted) return null;

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={requestClose}
    >
      <View style={styles.root}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.disc,
            {
              width: geometry.disc,
              height: geometry.disc,
              borderRadius: geometry.disc / 2,
              left: geometry.left,
              top: geometry.top,
              transform: [{ scale: discScale }],
            },
          ]}
        >
          <Animated.View
            style={[styles.steelFill, { opacity: steelOpacity }]}
          />
          <Animated.View
            style={[styles.mistClip, { opacity: mistOpacity }]}
          >
            <MistBackdrop style={styles.fill} />
          </Animated.View>
        </Animated.View>

        <Animated.View
          style={[
            styles.screen,
            {
              opacity: contentOpacity,
              transform: [{ translateY: contentLift }],
            },
          ]}
        >
          <KeyboardAvoidingView
            style={styles.flex}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <ScrollView
              style={styles.flex}
              contentContainerStyle={[
                styles.form,
                {
                  paddingTop: insets.top + space.xl,
                  paddingBottom: insets.bottom + space.xxl,
                },
              ]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Pressable onPress={Keyboard.dismiss} accessible={false}>
                <View style={styles.hero}>
                  <Text style={styles.lead}>Add </Text>
                  <Text style={styles.trail}>drive</Text>
                </View>
                <Text style={styles.support}>
                  Post to the open board for drivers nearby.
                </Text>

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
                  Post drive
                </Button>
                <Button
                  variant="quiet"
                  disabled={submitting}
                  onPress={requestClose}
                >
                  Cancel
                </Button>
                {submitting ? <LoadingHint label="Posting…" /> : null}
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  disc: {
    position: 'absolute',
    overflow: 'hidden',
  },
  steelFill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.accent,
  },
  mistClip: {
    ...StyleSheet.absoluteFillObject,
  },
  fill: {
    flex: 1,
  },
  screen: {
    ...StyleSheet.absoluteFillObject,
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
