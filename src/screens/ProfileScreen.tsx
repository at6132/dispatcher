import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
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
import { ChevronLeft, ChevronRight, Pencil, Settings, X } from 'lucide-react-native';

import { mapApiError } from '../api/errors';
import {
  getNotificationPrefs,
  normalizeNotificationPrefs,
  updateNotificationPrefs,
  type DriveStatusPrefMode,
  type NotificationPrefMode,
  type NotificationPrefs,
} from '../api/notifications';
import { useAuth } from '../auth/AuthContext';
import {
  buildOnboardingProfile,
  validateOnboardingExperience,
  validateOnboardingVehicle,
  validateOnboardingZelle,
} from '../auth/onboardingValidation';
import {
  VEHICLE_CLASS_OPTIONS,
  type VehicleClass,
} from '../auth/types';
import { getSessionUser } from '../auth/sessionStore';
import { formatPhoneDisplay, validateName } from '../auth/validation';
import { Button } from '../components/ui/Button';
import { ChoiceGroup } from '../components/ui/ChoiceGroup';
import { DriverCard } from '../components/ui/DriverCard';
import { Icon } from '../components/ui/Icon';
import { LoadingHint } from '../components/ui/LoadingHint';
import { NumberStepper } from '../components/ui/NumberStepper';
import { PhotoPickerField } from '../components/ui/PhotoPickerField';
import { TextField } from '../components/ui/TextField';
import { MistBackdrop, colors, fonts, space, type } from '../theme';

const PREF_OPTIONS: { value: NotificationPrefMode; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'all', label: 'Everyone' },
  { value: 'favorites', label: 'Favorites only' },
];

const DRIVE_STATUS_OPTIONS: { value: DriveStatusPrefMode; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'all', label: 'On' },
];

const DEFAULT_PREFS: NotificationPrefs = {
  newApplication: 'all',
  driveStatus: 'all',
  applicationAccepted: 'all',
  newDrivePosted: 'all',
  cancelRequest: 'all',
  applicationCleared: 'all',
};
type ProfileScreenProps = {
  visible: boolean;
  onClose: () => void;
};

function vehicleClassLabel(value: VehicleClass | undefined): string | undefined {
  if (!value) return undefined;
  return VEHICLE_CLASS_OPTIONS.find((o) => o.value === value)?.label;
}

function drivesLabel(count: number): string {
  return count === 1 ? '1 completed drive' : `${count} completed drives`;
}

export function ProfileScreen({ visible, onClose }: ProfileScreenProps) {
  const insets = useSafeAreaInsets();
  const { user, updateProfile } = useAuth();
  const [mounted, setMounted] = useState(visible);
  const [editing, setEditing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;

  const [name, setName] = useState('');
  const [vehicleClass, setVehicleClass] = useState<VehicleClass | null>(null);
  const [vehicleType, setVehicleType] = useState('');
  const [seats, setSeats] = useState(4);
  const [years, setYears] = useState(0);
  const [extraInfo, setExtraInfo] = useState('');
  const [zelle, setZelle] = useState('');
  const [selfPhotoUri, setSelfPhotoUri] = useState<string | undefined>();
  const [interiorUri, setInteriorUri] = useState<string | undefined>();
  const [exteriorUri, setExteriorUri] = useState<string | undefined>();
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [completedCount, setCompletedCount] = useState(0);
  const [notifPrefs, setNotifPrefs] =
    useState<NotificationPrefs>(DEFAULT_PREFS);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifSaving, setNotifSaving] = useState(false);
  const [notifError, setNotifError] = useState<string | null>(null);

  const syncFromUser = () => {
    if (!user) return;
    const ob = user.onboarding;
    setName(user.name);
    setVehicleClass(ob?.vehicleClass ?? null);
    setVehicleType(ob?.vehicleType ?? '');
    setSeats(ob?.seats ?? 4);
    setYears(ob?.yearsDrivingUpstate ?? 0);
    setExtraInfo(ob?.extraInfo ?? '');
    setZelle(ob?.zelle ?? '');
    setSelfPhotoUri(ob?.selfPhotoUri);
    setInteriorUri(ob?.vehicleInteriorUri);
    setExteriorUri(ob?.vehicleExteriorUri);
    setCompletedCount(user.completedDrivesCount ?? 0);
    setSubmitted(false);
    setSaving(false);
    setFormError(null);
  };

  useEffect(() => {
    if (visible) {
      setMounted(true);
      setEditing(false);
      setSettingsOpen(false);
      syncFromUser();
      progress.setValue(0);
      Animated.timing(progress, {
        toValue: 1,
        duration: 320,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
        useNativeDriver: true,
      }).start();
      void getSessionUser()
        .then((fresh) => {
          if (fresh?.completedDrivesCount != null) {
            setCompletedCount(fresh.completedDrivesCount);
          }
        })
        .catch(() => {
          /* keep cached count */
        });
      return;
    }

    if (!mounted) return;
    Animated.timing(progress, {
      toValue: 0,
      duration: 220,
      easing: Easing.bezier(0.4, 0, 1, 0.2),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setMounted(false);
        setEditing(false);
        setSettingsOpen(false);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- visibility-driven
  }, [visible]);

  const requestClose = () => {
    if (saving) return;
    Keyboard.dismiss();
    onClose();
  };

  const startEdit = () => {
    setSettingsOpen(false);
    syncFromUser();
    setEditing(true);
  };

  const cancelEdit = () => {
    Keyboard.dismiss();
    syncFromUser();
    setEditing(false);
  };

  const openSettings = () => {
    Keyboard.dismiss();
    setEditing(false);
    setSettingsOpen(true);
    setNotifError(null);
    setNotifLoading(true);
    void getNotificationPrefs()
      .then((prefs) => {
        setNotifPrefs(normalizeNotificationPrefs(prefs));
      })
      .catch((err) => {
        setNotifError(mapApiError(err).message);
      })
      .finally(() => {
        setNotifLoading(false);
      });
  };

  const closeSettings = () => {
    setSettingsOpen(false);
  };

  const patchNotifPref = async <K extends keyof NotificationPrefs>(
    key: K,
    value: NotificationPrefs[K],
  ) => {
    const prev = notifPrefs;
    const next = { ...prev, [key]: value };
    setNotifPrefs(next);
    setNotifError(null);
    setNotifSaving(true);
    try {
      const saved = await updateNotificationPrefs({ [key]: value });
      setNotifPrefs(normalizeNotificationPrefs(saved));
    } catch (err) {
      setNotifPrefs(prev);
      setNotifError(mapApiError(err).message);
    } finally {
      setNotifSaving(false);
    }
  };

  const nameError = submitted ? validateName(name) : undefined;
  const vehicleErrors = submitted
    ? validateOnboardingVehicle({ vehicleClass, vehicleType, seats })
    : {};
  const experienceErrors = submitted
    ? validateOnboardingExperience({ yearsDrivingUpstate: years })
    : {};
  const zelleErrors = submitted ? validateOnboardingZelle({ zelle }) : {};

  const onSave = async () => {
    setSubmitted(true);
    setFormError(null);
    Keyboard.dismiss();

    const nameIssue = validateName(name);
    const vErr = validateOnboardingVehicle({ vehicleClass, vehicleType, seats });
    const eErr = validateOnboardingExperience({ yearsDrivingUpstate: years });
    const zErr = validateOnboardingZelle({ zelle });
    if (
      nameIssue ||
      Object.keys(vErr).length ||
      Object.keys(eErr).length ||
      Object.keys(zErr).length ||
      !vehicleClass
    ) {
      return;
    }

    setSaving(true);
    try {
      await updateProfile({
        name,
        onboarding: buildOnboardingProfile({
          vehicleClass,
          vehicleType,
          seats,
          yearsDrivingUpstate: years,
          extraInfo,
          zelle,
          selfPhotoUri,
          vehicleInteriorUri: interiorUri,
          vehicleExteriorUri: exteriorUri,
        }),
      });
      setEditing(false);
      setSubmitted(false);
    } catch (err) {
      setFormError(mapApiError(err).message);
    } finally {
      setSaving(false);
    }
  };

  const ob = user?.onboarding;
  const detailParts: string[] = [];
  if (ob?.seats != null) detailParts.push(`${ob.seats} seats`);
  if (ob?.yearsDrivingUpstate != null) {
    detailParts.push(`${ob.yearsDrivingUpstate} yrs upstate`);
  }
  const classLabel = vehicleClassLabel(ob?.vehicleClass);
  if (classLabel) detailParts.push(classLabel);

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
      <Animated.View style={[styles.root, { opacity: progress }]}>
        <MistBackdrop style={styles.fill} />
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={[styles.topBar, { paddingTop: insets.top + space.sm }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                settingsOpen
                  ? 'Back to profile'
                  : editing
                    ? 'Cancel editing'
                    : 'Close'
              }
              hitSlop={12}
              disabled={saving}
              onPress={
                settingsOpen
                  ? closeSettings
                  : editing
                    ? cancelEdit
                    : requestClose
              }
              style={({ pressed }) => [
                styles.iconBtn,
                pressed && styles.iconBtnPressed,
                saving && styles.iconBtnDisabled,
              ]}
            >
              <Icon
                icon={settingsOpen ? ChevronLeft : X}
                size="md"
                color={colors.inkSoft}
              />
            </Pressable>
            {!editing && !settingsOpen ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit profile"
                hitSlop={12}
                onPress={startEdit}
                style={({ pressed }) => [
                  styles.editChip,
                  pressed && styles.iconBtnPressed,
                ]}
              >
                <Icon icon={Pencil} size="sm" color={colors.accent} />
                <Text style={styles.editChipLabel}>Edit</Text>
              </Pressable>
            ) : (
              <View style={styles.topSpacer} />
            )}
          </View>

          <ScrollView
            style={styles.flex}
            contentContainerStyle={[
              styles.content,
              { paddingBottom: insets.bottom + space.xxl },
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Pressable onPress={Keyboard.dismiss} accessible={false}>
              {settingsOpen ? (
                <View style={styles.viewBlock}>
                  <View style={styles.hero}>
                    <Text style={styles.lead}>App </Text>
                    <Text style={styles.trail}>settings</Text>
                  </View>
                  <Text style={styles.support}>
                    Notification preferences and more.
                  </Text>

                  <View style={styles.settingsSection}>
                    <Text style={styles.statLabel}>When you post</Text>
                    {notifLoading ? (
                      <LoadingHint label="Loading…" variant="inline" />
                    ) : (
                      <View style={styles.notifStack}>
                        <ChoiceGroup
                          label="New applications"
                          options={PREF_OPTIONS}
                          value={notifPrefs.newApplication}
                          onChange={(v) =>
                            void patchNotifPref('newApplication', v)
                          }
                        />
                        <Text style={styles.notifHint}>
                          Favorites only = favorited drivers who apply.
                        </Text>
                        <ChoiceGroup
                          label="Ride status changes"
                          options={DRIVE_STATUS_OPTIONS}
                          value={notifPrefs.driveStatus}
                          onChange={(v) =>
                            void patchNotifPref('driveStatus', v)
                          }
                        />
                        <Text style={styles.notifHint}>
                          Picked up, completed, or cancelled.
                        </Text>
                        <ChoiceGroup
                          label="Cancel requests"
                          options={PREF_OPTIONS}
                          value={notifPrefs.cancelRequest}
                          onChange={(v) =>
                            void patchNotifPref('cancelRequest', v)
                          }
                        />
                        <Text style={styles.notifHint}>
                          When a driver asks to cancel. Favorites only =
                          favorited drivers.
                        </Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.settingsSection}>
                    <Text style={styles.statLabel}>When you drive</Text>
                    {notifLoading ? null : (
                      <View style={styles.notifStack}>
                        <ChoiceGroup
                          label="You got the job"
                          options={PREF_OPTIONS}
                          value={notifPrefs.applicationAccepted}
                          onChange={(v) =>
                            void patchNotifPref('applicationAccepted', v)
                          }
                        />
                        <Text style={styles.notifHint}>
                          Favorites only = favorited dispatchers.
                        </Text>
                        <ChoiceGroup
                          label="Submissions cleared"
                          options={PREF_OPTIONS}
                          value={notifPrefs.applicationCleared}
                          onChange={(v) =>
                            void patchNotifPref('applicationCleared', v)
                          }
                        />
                        <Text style={styles.notifHint}>
                          When a dispatcher clears applies on a post you
                          applied to. Favorites = favorited dispatchers.
                        </Text>
                        <ChoiceGroup
                          label="New drives posted"
                          options={PREF_OPTIONS}
                          value={notifPrefs.newDrivePosted}
                          onChange={(v) =>
                            void patchNotifPref('newDrivePosted', v)
                          }
                        />
                        <Text style={styles.notifHint}>
                          Any new board post. Favorites = favorited
                          dispatchers only.
                        </Text>
                      </View>
                    )}
                    {notifSaving ? (
                      <LoadingHint label="Saving…" variant="inline" />
                    ) : null}
                    {notifError ? (
                      <Text style={styles.formError}>{notifError}</Text>
                    ) : null}
                  </View>
                </View>
              ) : (
                <>
              <View style={styles.hero}>
                <Text style={styles.lead}>
                  {editing ? 'Edit' : 'Your'}{' '}
                </Text>
                <Text style={styles.trail}>profile</Text>
              </View>
              <Text style={styles.support}>
                {editing
                  ? 'Update what other drivers see. Drive count stays automatic.'
                  : 'What other drivers see when they open your profile.'}
              </Text>

              {!editing ? (
                <View style={styles.viewBlock}>
                  <DriverCard
                    photoUri={ob?.selfPhotoUri}
                    vehicleInteriorUri={ob?.vehicleInteriorUri}
                    vehicleExteriorUri={ob?.vehicleExteriorUri}
                    name={user?.name ?? ''}
                    vehicleType={ob?.vehicleType}
                    phone={
                      user?.phone
                        ? formatPhoneDisplay(user.phone)
                        : undefined
                    }
                    detail={detailParts.join(' · ') || undefined}
                    showMap={false}
                  />

                  <View style={styles.statRow}>
                    <Text style={styles.statLabel}>Drives</Text>
                    <Text style={styles.statValue}>
                      {drivesLabel(completedCount)}
                    </Text>
                  </View>

                  {ob?.zelle ? (
                    <View style={styles.fieldBlock}>
                      <Text style={styles.fieldLabel}>Zelle</Text>
                      <Text style={styles.fieldValue}>{ob.zelle}</Text>
                    </View>
                  ) : null}

                  {ob?.extraInfo ? (
                    <View style={styles.fieldBlock}>
                      <Text style={styles.fieldLabel}>Notes</Text>
                      <Text style={styles.fieldValue}>{ob.extraInfo}</Text>
                    </View>
                  ) : null}

                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Settings"
                    onPress={openSettings}
                    style={({ pressed }) => [
                      styles.settingsRow,
                      pressed && styles.settingsRowPressed,
                    ]}
                  >
                    <View style={styles.settingsRowLeft}>
                      <View style={styles.settingsIconWrap}>
                        <Icon icon={Settings} size="md" color={colors.accent} />
                      </View>
                      <Text style={styles.settingsRowLabel}>Settings</Text>
                    </View>
                    <Icon icon={ChevronRight} size="sm" color={colors.faint} />
                  </Pressable>
                </View>
              ) : (
                <View style={styles.fields}>
                  <View style={styles.photos}>
                    <PhotoPickerField
                      label="You"
                      uri={selfPhotoUri}
                      onChange={setSelfPhotoUri}
                      variant="avatar"
                    />
                    <View style={styles.vehiclePhotos}>
                      <PhotoPickerField
                        label="Exterior"
                        uri={exteriorUri}
                        onChange={setExteriorUri}
                        variant="rect"
                        compact
                      />
                      <PhotoPickerField
                        label="Interior"
                        uri={interiorUri}
                        onChange={setInteriorUri}
                        variant="rect"
                        compact
                      />
                    </View>
                  </View>

                  <TextField
                    label="Name"
                    value={name}
                    onChangeText={setName}
                    error={nameError}
                    autoCapitalize="words"
                  />

                  <View style={styles.fieldBlock}>
                    <Text style={styles.fieldLabel}>Phone</Text>
                    <Text style={styles.fieldValue}>
                      {user?.phone
                        ? formatPhoneDisplay(user.phone)
                        : '—'}
                    </Text>
                    <Text style={styles.fieldHint}>
                      Account phone can’t be changed here.
                    </Text>
                  </View>

                  <ChoiceGroup
                    label="Vehicle class"
                    options={VEHICLE_CLASS_OPTIONS}
                    value={vehicleClass}
                    onChange={setVehicleClass}
                    error={vehicleErrors.vehicleClass}
                  />

                  <TextField
                    label="Vehicle type"
                    value={vehicleType}
                    onChangeText={setVehicleType}
                    placeholder="Escalade, Sienna…"
                    error={vehicleErrors.vehicleType}
                    autoCapitalize="words"
                  />

                  <NumberStepper
                    label="Seats"
                    value={seats}
                    onChange={setSeats}
                    min={1}
                    max={20}
                    error={vehicleErrors.seats}
                  />

                  <NumberStepper
                    label="Years driving upstate"
                    value={years}
                    onChange={setYears}
                    min={0}
                    max={80}
                    error={experienceErrors.yearsDrivingUpstate}
                  />

                  <TextField
                    label="Extra info"
                    value={extraInfo}
                    onChangeText={setExtraInfo}
                    placeholder="Optional"
                    multiline
                  />

                  <TextField
                    label="Zelle"
                    value={zelle}
                    onChangeText={setZelle}
                    placeholder="Email or phone"
                    error={zelleErrors.zelle}
                    autoCapitalize="none"
                  />

                  <View style={styles.statRow}>
                    <Text style={styles.statLabel}>Drives</Text>
                    <Text style={styles.statValue}>
                      {drivesLabel(completedCount)}
                    </Text>
                    <Text style={styles.fieldHint}>
                      Counts completed jobs automatically.
                    </Text>
                  </View>

                  {formError ? (
                    <Text style={styles.formError}>{formError}</Text>
                  ) : null}

                  {saving ? (
                    <LoadingHint label="Saving…" variant="inline" />
                  ) : null}

                  <Button
                    onPress={() => void onSave()}
                    loading={saving}
                    disabled={saving}
                  >
                    Save
                  </Button>
                  <Button
                    variant="quiet"
                    onPress={cancelEdit}
                    disabled={saving}
                  >
                    Cancel
                  </Button>
                </View>
              )}
                </>
              )}
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </Animated.View>
    </Modal>
  );
}

const AVATAR = 40;

type ProfileButtonProps = {
  onPress: () => void;
  topInset: number;
};

/** Top-corner PFP — opens your public profile. */
export function ProfileButton({ onPress, topInset }: ProfileButtonProps) {
  const { user } = useAuth();
  const uri = user?.onboarding?.selfPhotoUri;
  const initial = (user?.name?.trim().charAt(0) || '?').toUpperCase();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Your profile"
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        styles.profileBtn,
        { top: topInset + space.md },
        pressed && styles.profileBtnPressed,
      ]}
    >
      {uri ? (
        <Image source={{ uri }} style={styles.profileBtnImage} />
      ) : (
        <View style={styles.profileBtnEmpty}>
          <Text style={styles.profileBtnInitial}>{initial}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  fill: {
    ...StyleSheet.absoluteFillObject,
  },
  flex: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  iconBtnPressed: {
    opacity: 0.75,
  },
  iconBtnDisabled: {
    opacity: 0.4,
  },
  editChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accentMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  editChipLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.accent,
  },
  topSpacer: {
    width: 40,
  },
  content: {
    paddingHorizontal: space.xl,
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    gap: space.lg,
  },
  hero: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
  },
  lead: {
    ...type.hero,
    color: colors.ink,
  },
  trail: {
    ...type.heroItalic,
    color: colors.ink,
  },
  support: {
    ...type.body,
    color: colors.muted,
    marginTop: -space.sm,
    marginBottom: space.sm,
  },
  viewBlock: {
    gap: space.lg,
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    borderRadius: 16,
    backgroundColor: colors.glass,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  settingsRowPressed: {
    opacity: 0.85,
  },
  settingsRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  settingsIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentMuted,
  },
  settingsRowLabel: {
    fontFamily: fonts.sansSemi,
    fontSize: 16,
    letterSpacing: -0.2,
    color: colors.ink,
  },
  settingsSection: {
    gap: space.md,
    marginTop: space.sm,
  },
  notifStack: {
    gap: space.lg,
  },
  notifHint: {
    ...type.caption,
    color: colors.faint,
    marginTop: -space.sm,
  },
  comingSoonCard: {
    paddingVertical: space.xl,
    paddingHorizontal: space.lg,
    borderRadius: 16,
    backgroundColor: colors.glass,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    alignItems: 'center',
  },
  comingSoon: {
    fontFamily: fonts.sansMedium,
    fontSize: 16,
    color: colors.muted,
  },
  statRow: {
    gap: space.xs,
    paddingVertical: space.sm,
  },
  statLabel: {
    ...type.label,
    color: colors.faint,
    textTransform: 'uppercase',
  },
  statValue: {
    fontFamily: fonts.sansSemi,
    fontSize: 18,
    letterSpacing: -0.2,
    color: colors.ink,
  },
  fieldBlock: {
    gap: space.xs,
  },
  fieldLabel: {
    ...type.label,
    color: colors.faint,
    textTransform: 'uppercase',
  },
  fieldValue: {
    ...type.body,
    color: colors.inkSoft,
  },
  fieldHint: {
    ...type.caption,
    color: colors.faint,
  },
  fields: {
    gap: space.lg,
  },
  photos: {
    gap: space.lg,
    alignItems: 'center',
  },
  vehiclePhotos: {
    flexDirection: 'row',
    gap: space.md,
    width: '100%',
  },
  formError: {
    ...type.caption,
    color: colors.danger,
  },
  profileBtn: {
    position: 'absolute',
    right: space.xl,
    zIndex: 20,
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    overflow: 'hidden',
    backgroundColor: colors.canvasDeep,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  profileBtnPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
  profileBtnImage: {
    width: '100%',
    height: '100%',
  },
  profileBtnEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentMuted,
  },
  profileBtnInitial: {
    fontFamily: fonts.display,
    fontSize: 18,
    color: colors.accent,
  },
});
