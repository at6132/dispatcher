import { useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { mapApiError } from '../../api/errors';
import { useAuth } from '../../auth/AuthContext';
import {
  buildOnboardingProfile,
  validateOnboardingExperience,
  validateOnboardingVehicle,
  validateOnboardingZelle,
} from '../../auth/onboardingValidation';
import {
  VEHICLE_CLASS_OPTIONS,
  type VehicleClass,
} from '../../auth/types';
import { Button } from '../../components/ui/Button';
import { ChoiceGroup } from '../../components/ui/ChoiceGroup';
import { LoadingHint } from '../../components/ui/LoadingHint';
import { NumberStepper } from '../../components/ui/NumberStepper';
import {
  PhotoPickerField,
} from '../../components/ui/PhotoPickerField';
import {
  PhotoAccessPrompt,
  type PhotoAccessState,
} from '../../components/ui/PhotoAccessPrompt';
import {
  LocationAccessPrompt,
  isLocationAccessReady,
  type LocationAccessState,
} from '../../components/ui/LocationAccessPrompt';
import { RollerWheel } from '../../components/ui/RollerWheel';
import { TextField } from '../../components/ui/TextField';
import { logger } from '../../debug/logger';
import { MistBackdrop, colors, fonts, space, type } from '../../theme';

type Step = 0 | 1 | 2 | 3 | 4;

const STEP_COPY: Record<
  Step,
  { lead: string; trail: string; body?: string }
> = {
  0: {
    lead: 'Your',
    trail: 'vehicle',
    body: 'Class, type, and seats — required so we can match rides.',
  },
  1: {
    lead: 'Add',
    trail: 'photos',
  },
  2: {
    lead: 'Upstate',
    trail: 'experience',
    body: 'Years driving upstate required. Notes optional.',
  },
  3: {
    lead: 'Allow',
    trail: 'location',
    body: 'Needed to match you with rides.',
  },
  4: {
    lead: 'Zelle',
    trail: 'info',
    body: 'If you plan on posting rides, please provide this information.',
  },
};

export function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const { completeOnboarding } = useAuth();

  const [step, setStep] = useState<Step>(0);
  const [vehicleClass, setVehicleClass] = useState<VehicleClass | null>(null);
  const [vehicleType, setVehicleType] = useState('');
  const [seats, setSeats] = useState(4);
  const [selfPhotoUri, setSelfPhotoUri] = useState<string | undefined>();
  const [vehicleInteriorUri, setVehicleInteriorUri] = useState<
    string | undefined
  >();
  const [vehicleExteriorUri, setVehicleExteriorUri] = useState<
    string | undefined
  >();
  const [yearsDrivingUpstate, setYearsDrivingUpstate] = useState(0);
  const [extraInfo, setExtraInfo] = useState('');
  const [zelle, setZelle] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [photoAccess, setPhotoAccess] = useState<PhotoAccessState>('unknown');
  const [locationAccess, setLocationAccess] =
    useState<LocationAccessState>('unknown');

  const vehicleErrors = validateOnboardingVehicle({
    vehicleClass,
    vehicleType,
    seats,
  });
  const experienceErrors = validateOnboardingExperience({
    yearsDrivingUpstate,
  });
  const zelleErrors = validateOnboardingZelle({ zelle });

  const copy = STEP_COPY[step];
  const canPickPhotos = photoAccess === 'all' || photoAccess === 'limited';

  const goNext = async () => {
    Keyboard.dismiss();
    setFormError(null);
    setSubmitted(true);

    if (step === 0) {
      if (Object.keys(vehicleErrors).length) {
        logger.info('onboarding', 'step0.validation_fail', { vehicleErrors });
        return;
      }
      setSubmitted(false);
      setStep(1);
      logger.info('onboarding', 'step', { from: 0, to: 1 });
      return;
    }

    if (step === 1) {
      setSubmitted(false);
      setStep(2);
      logger.info('onboarding', 'step', {
        from: 1,
        to: 2,
        hasPhotos: Boolean(selfPhotoUri || vehicleInteriorUri || vehicleExteriorUri),
      });
      return;
    }

    if (step === 2) {
      if (Object.keys(experienceErrors).length) {
        logger.info('onboarding', 'step2.validation_fail', { experienceErrors });
        return;
      }
      setSubmitted(false);
      setStep(3);
      logger.info('onboarding', 'step', { from: 2, to: 3 });
      return;
    }

    if (step === 3) {
      if (!isLocationAccessReady(locationAccess)) {
        logger.info('onboarding', 'step3.location_blocked', { locationAccess });
        setFormError(
          'Allow location to continue. Use the button above or open Settings.',
        );
        return;
      }
      setFormError(null);
      setSubmitted(false);
      setStep(4);
      logger.info('onboarding', 'step', { from: 3, to: 4 });
      return;
    }

    if (Object.keys(zelleErrors).length) {
      logger.info('onboarding', 'step4.validation_fail', { zelleErrors });
      return;
    }
    if (!vehicleClass) {
      setFormError('Something’s missing. Go back and check required fields.');
      return;
    }

    setSubmitting(true);
    logger.info('onboarding', 'submit.start', {
      vehicleClass,
      seats,
      yearsDrivingUpstate,
      hasSelfPhoto: Boolean(selfPhotoUri),
      hasInterior: Boolean(vehicleInteriorUri),
      hasExterior: Boolean(vehicleExteriorUri),
      hasZelle: Boolean(zelle.trim()),
    });
    try {
      // Auth seals onboardingComplete optimistically — Root will leave this
      // screen. Don’t clear submitting / show errors after unmount.
      await completeOnboarding(
        buildOnboardingProfile({
          vehicleClass,
          vehicleType,
          seats,
          selfPhotoUri,
          vehicleInteriorUri,
          vehicleExteriorUri,
          yearsDrivingUpstate,
          extraInfo,
          zelle,
        }),
      );
      logger.info('onboarding', 'submit.ok');
    } catch (err) {
      const mapped = mapApiError(err, 'onboarding');
      logger.error('onboarding', 'submit.fail', {
        message: mapped.message,
        code: mapped.code,
        requestId: (err as { requestId?: string }).requestId,
        status: (err as { status?: number }).status,
      });
      // Completion is sealed optimistically + retried on bootstrap. Only show
      // an error if we’re somehow still on this screen.
      setFormError(mapped.message);
      setSubmitting(false);
    }
  };

  const goBack = () => {
    if (submitting) return;
    Keyboard.dismiss();
    setFormError(null);
    setSubmitted(false);
    if (step === 0) return;
    setStep((s) => (s - 1) as Step);
  };

  const hasPhotos = Boolean(
    selfPhotoUri || vehicleInteriorUri || vehicleExteriorUri,
  );

  return (
    <MistBackdrop>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.flex}>
          {/* Behind content so taps on empty space dismiss; doesn’t steal scroll. */}
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={Keyboard.dismiss}
            accessible={false}
          />
          <View
            pointerEvents="box-none"
            style={[
              styles.screen,
              {
                paddingTop: insets.top + space.lg,
                paddingBottom: insets.bottom + space.lg,
              },
            ]}
          >
            <View style={styles.stage} pointerEvents="box-none">
              <View style={styles.top} pointerEvents="box-none">
                <Pressable onPress={Keyboard.dismiss} accessible={false}>
                  <View style={styles.progressRow}>
                    {[0, 1, 2, 3, 4].map((n) => (
                      <View
                        key={n}
                        style={[
                          styles.progressDot,
                          n <= step && styles.progressDotActive,
                        ]}
                      />
                    ))}
                  </View>
                </Pressable>

                <Pressable onPress={Keyboard.dismiss} accessible={false}>
                  <View style={styles.header}>
                    <Text style={styles.lead}>{copy.lead}</Text>
                    <Text style={styles.trail}>{copy.trail}</Text>
                    {copy.body ? (
                      <Text style={styles.body}>{copy.body}</Text>
                    ) : null}
                  </View>
                </Pressable>

                <View style={styles.form} pointerEvents="box-none">
                {step === 0 ? (
                  <>
                    <ChoiceGroup
                      label="Vehicle class"
                      options={VEHICLE_CLASS_OPTIONS}
                      value={vehicleClass}
                      onChange={setVehicleClass}
                      error={
                        submitted ? vehicleErrors.vehicleClass : undefined
                      }
                    />
                    <TextField
                      label="Vehicle type"
                      value={vehicleType}
                      onChangeText={setVehicleType}
                      error={
                        submitted ? vehicleErrors.vehicleType : undefined
                      }
                      autoCapitalize="words"
                      placeholder="e.g. Escalade"
                      editable={!submitting}
                      returnKeyType="next"
                    />
                    <NumberStepper
                      label="Seats"
                      hint="Including driver"
                      value={seats}
                      min={1}
                      max={20}
                      onChange={setSeats}
                      error={submitted ? vehicleErrors.seats : undefined}
                    />
                  </>
                ) : null}

                {step === 1 ? (
                  <>
                    <PhotoAccessPrompt onAccessChange={setPhotoAccess} />
                    {canPickPhotos ? (
                      <View style={styles.photoStack}>
                        <PhotoPickerField
                          label="You"
                          uri={selfPhotoUri}
                          onChange={setSelfPhotoUri}
                          variant="avatar"
                        />
                        <View style={styles.vehiclePhotos}>
                          <Text style={styles.vehiclePhotosLabel}>Vehicle</Text>
                          <View style={styles.photoRow}>
                            <View style={styles.photoCol}>
                              <PhotoPickerField
                                label="Interior"
                                uri={vehicleInteriorUri}
                                onChange={setVehicleInteriorUri}
                                compact
                              />
                            </View>
                            <View style={styles.photoCol}>
                              <PhotoPickerField
                                label="Exterior"
                                uri={vehicleExteriorUri}
                                onChange={setVehicleExteriorUri}
                                compact
                              />
                            </View>
                          </View>
                        </View>
                        <Text style={styles.photosOptional}>All optional</Text>
                      </View>
                    ) : null}
                  </>
                ) : null}

                {step === 2 ? (
                  <>
                    <RollerWheel
                      label="Years driving upstate"
                      value={yearsDrivingUpstate}
                      onChange={(n) =>
                        setYearsDrivingUpstate(Math.max(0, Math.min(50, n)))
                      }
                      min={0}
                      max={50}
                      suffix="years"
                      error={
                        submitted
                          ? experienceErrors.yearsDrivingUpstate
                          : undefined
                      }
                    />
                    <TextField
                      label="Anything else"
                      value={extraInfo}
                      onChangeText={setExtraInfo}
                      editable={!submitting}
                      placeholder="e.g. past driving experience"
                    />
                  </>
                ) : null}

                {step === 3 ? (
                  <LocationAccessPrompt onAccessChange={setLocationAccess} />
                ) : null}

                {step === 4 ? (
                  <TextField
                    label="Zelle email or phone"
                    value={zelle}
                    onChangeText={setZelle}
                    error={submitted ? zelleErrors.zelle : undefined}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    autoComplete="email"
                    textContentType="username"
                    returnKeyType="go"
                    editable={!submitting}
                    onSubmitEditing={() => void goNext()}
                  />
                ) : null}

                {formError ? (
                  <Text style={styles.formError} accessibilityRole="alert">
                    {formError}
                  </Text>
                ) : null}
              </View>
            </View>

            <View style={styles.actions}>
              <Button
                onPress={() => void goNext()}
                loading={submitting}
                disabled={submitting}
                accessibilityLabel={
                  step === 4 ? 'Finish onboarding' : 'Continue'
                }
              >
                {step === 1
                  ? hasPhotos
                    ? 'Continue'
                    : 'Skip photos'
                  : step === 3
                    ? isLocationAccessReady(locationAccess)
                      ? 'Continue'
                      : 'Allow location to continue'
                    : step === 4
                      ? zelle.trim()
                        ? 'Finish'
                        : 'Skip'
                      : 'Continue'}
              </Button>

              {submitting ? (
                <LoadingHint
                  label={
                    hasPhotos
                      ? 'Saving profile and uploading photos…'
                      : 'Saving your profile…'
                  }
                />
              ) : null}

              {step > 0 ? (
                <Pressable
                  onPress={goBack}
                  disabled={submitting}
                  hitSlop={10}
                  style={[styles.back, submitting && styles.backDisabled]}
                >
                  <Text style={styles.backLabel}>Back</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>
        </View>
      </KeyboardAvoidingView>
    </MistBackdrop>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  screen: {
    flex: 1,
    paddingHorizontal: space.xl,
  },
  stage: {
    flex: 1,
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
    justifyContent: 'space-between',
  },
  top: {
    gap: space.xl,
    flexShrink: 1,
  },
  progressRow: {
    flexDirection: 'row',
    gap: space.sm,
  },
  progressDot: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.hairline,
  },
  progressDotActive: {
    backgroundColor: colors.accent,
  },
  header: {
    gap: space.xs,
  },
  lead: {
    ...type.hero,
    color: colors.ink,
  },
  trail: {
    ...type.heroItalic,
    color: colors.accent,
  },
  body: {
    ...type.body,
    color: colors.muted,
    marginTop: space.sm,
  },
  form: {
    gap: space.lg,
  },
  photoStack: {
    gap: space.xl,
  },
  vehiclePhotos: {
    gap: space.sm,
  },
  vehiclePhotosLabel: {
    ...type.label,
    color: colors.muted,
    textTransform: 'uppercase',
    paddingLeft: space.xs,
  },
  photosOptional: {
    fontFamily: fonts.sansMedium,
    fontSize: 16,
    color: colors.muted,
    textAlign: 'center',
    marginTop: space.sm,
  },
  photoRow: {
    flexDirection: 'row',
    gap: space.md,
  },
  photoCol: {
    flex: 1,
  },
  actions: {
    gap: space.md,
    paddingTop: space.lg,
  },
  formError: {
    ...type.caption,
    color: colors.danger,
  },
  back: {
    alignSelf: 'center',
    paddingVertical: space.sm,
  },
  backDisabled: {
    opacity: 0.4,
  },
  backLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.accent,
  },
});
