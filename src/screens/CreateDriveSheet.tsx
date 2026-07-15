import { useEffect, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
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
import { Button } from '../components/ui/Button';
import { ChoiceGroup } from '../components/ui/ChoiceGroup';
import { Icon } from '../components/ui/Icon';
import { LoadingHint } from '../components/ui/LoadingHint';
import { NumberStepper } from '../components/ui/NumberStepper';
import { TextField } from '../components/ui/TextField';
import { MistBackdrop, colors, fonts, space, type } from '../theme';

type CreateDriveSheetProps = {
  visible: boolean;
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
  onClose,
  onCreated,
}: CreateDriveSheetProps) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

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
    if (!visible) resetForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- visibility-driven
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

  return (
    <Modal
      visible={visible}
      animationType="fade"
      statusBarTranslucent
      presentationStyle="fullScreen"
      onRequestClose={requestClose}
    >
      <MistBackdrop style={styles.root}>
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
              {submitting ? <LoadingHint label="Posting…" /> : null}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </MistBackdrop>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
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
