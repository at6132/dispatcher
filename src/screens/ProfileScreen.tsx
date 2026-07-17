import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, Pencil, Settings } from 'lucide-react-native';

import { mapApiError } from '../api/errors';
import {
  getNotificationPrefs,
  normalizeNotificationPrefs,
  updateNotificationPrefs,
  type DriveStatusPrefMode,
  type NotificationPrefMode,
  type NotificationPrefs,
} from '../api/notifications';
import {
  listProfileHistory,
  type ProfileTripHistoryItem,
} from '../api/profiles';
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
import { bottomNavClearance } from '../components/navigation/BottomNav';
import { Button } from '../components/ui/Button';
import { ChoiceGroup } from '../components/ui/ChoiceGroup';
import { DriverCard } from '../components/ui/DriverCard';
import { Icon } from '../components/ui/Icon';
import { LoadingHint } from '../components/ui/LoadingHint';
import { NumberStepper } from '../components/ui/NumberStepper';
import { PhotoPickerField } from '../components/ui/PhotoPickerField';
import { TextField } from '../components/ui/TextField';
import { colors, fonts, radius, space, type } from '../theme';

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
function vehicleClassLabel(value: VehicleClass | undefined): string | undefined {
  if (!value) return undefined;
  return VEHICLE_CLASS_OPTIONS.find((o) => o.value === value)?.label;
}

function drivesLabel(count: number): string {
  return count === 1 ? '1 completed drive' : `${count} completed drives`;
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user, updateProfile, signOut, deleteAccount } = useAuth();
  const [editing, setEditing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);

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
  const [history, setHistory] = useState<ProfileTripHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [notifPrefs, setNotifPrefs] =
    useState<NotificationPrefs>(DEFAULT_PREFS);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifSaving, setNotifSaving] = useState(false);
  const [notifError, setNotifError] = useState<string | null>(null);

  const syncFromUser = useCallback(() => {
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
  }, [user]);

  useEffect(() => {
    setEditing(false);
    setSettingsOpen(false);
    syncFromUser();
    void getSessionUser()
      .then((fresh) => {
        if (fresh?.completedDrivesCount != null) {
          setCompletedCount(fresh.completedDrivesCount);
        }
      })
      .catch(() => {
        /* keep cached count */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount sync
  }, []);

  useEffect(() => {
    const userId = user?.id;
    if (!userId) {
      setHistory([]);
      setHistoryError(null);
      setHistoryLoading(false);
      return;
    }
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError(null);
    void (async () => {
      try {
        const data = await listProfileHistory(userId, { limit: 30 });
        if (cancelled) return;
        setHistory(data.items ?? []);
      } catch {
        if (cancelled) return;
        setHistory([]);
        setHistoryError('Couldn’t load drives.');
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const startEdit = useCallback(() => {
    setSettingsOpen(false);
    syncFromUser();
    setEditing(true);
  }, [syncFromUser]);

  const cancelEdit = useCallback(() => {
    Keyboard.dismiss();
    syncFromUser();
    setEditing(false);
  }, [syncFromUser]);

  const openSettings = useCallback(() => {
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
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  const onSignOut = useCallback(() => {
    Alert.alert('Sign out?', 'You’ll need your phone and password to sign back in.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setAccountBusy(true);
            setNotifError(null);
            try {
              await signOut();
            } catch (err) {
              setNotifError(mapApiError(err).message);
              setAccountBusy(false);
            }
          })();
        },
      },
    ]);
  }, [signOut]);

  const onDeleteAccount = useCallback(() => {
    Alert.alert(
      'Delete account?',
      'This permanently removes your profile, posts, and applications. Open balances must be settled first. This can’t be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Are you sure?',
              'Your account and data will be deleted immediately.',
              [
                { text: 'Keep account', style: 'cancel' },
                {
                  text: 'Delete forever',
                  style: 'destructive',
                  onPress: () => {
                    void (async () => {
                      setAccountBusy(true);
                      setNotifError(null);
                      try {
                        await deleteAccount();
                      } catch (err) {
                        setNotifError(mapApiError(err).message);
                        setAccountBusy(false);
                      }
                    })();
                  },
                },
              ],
            );
          },
        },
      ],
    );
  }, [deleteAccount]);

  const patchNotifPref = useCallback(
    async <K extends keyof NotificationPrefs>(
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
    },
    [notifPrefs],
  );

  const onNewApplicationChange = useCallback(
    (v: NotificationPrefMode) => {
      void patchNotifPref('newApplication', v);
    },
    [patchNotifPref],
  );
  const onDriveStatusChange = useCallback(
    (v: DriveStatusPrefMode) => {
      void patchNotifPref('driveStatus', v);
    },
    [patchNotifPref],
  );
  const onCancelRequestChange = useCallback(
    (v: NotificationPrefMode) => {
      void patchNotifPref('cancelRequest', v);
    },
    [patchNotifPref],
  );
  const onApplicationAcceptedChange = useCallback(
    (v: NotificationPrefMode) => {
      void patchNotifPref('applicationAccepted', v);
    },
    [patchNotifPref],
  );
  const onApplicationClearedChange = useCallback(
    (v: NotificationPrefMode) => {
      void patchNotifPref('applicationCleared', v);
    },
    [patchNotifPref],
  );
  const onNewDrivePostedChange = useCallback(
    (v: NotificationPrefMode) => {
      void patchNotifPref('newDrivePosted', v);
    },
    [patchNotifPref],
  );

  const nameError = submitted ? validateName(name) : undefined;
  const vehicleErrors = useMemo(
    () =>
      submitted
        ? validateOnboardingVehicle({ vehicleClass, vehicleType, seats })
        : {},
    [submitted, vehicleClass, vehicleType, seats],
  );
  const experienceErrors = useMemo(
    () =>
      submitted
        ? validateOnboardingExperience({ yearsDrivingUpstate: years })
        : {},
    [submitted, years],
  );
  const zelleErrors = useMemo(
    () => (submitted ? validateOnboardingZelle({ zelle }) : {}),
    [submitted, zelle],
  );

  const onSave = useCallback(async () => {
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
  }, [
    name,
    vehicleClass,
    vehicleType,
    seats,
    years,
    extraInfo,
    zelle,
    selfPhotoUri,
    interiorUri,
    exteriorUri,
    updateProfile,
  ]);

  const ob = user?.onboarding;
  const driverDetail = useMemo(() => {
    const parts: string[] = [];
    if (ob?.seats != null) parts.push(`${ob.seats} seats`);
    if (ob?.yearsDrivingUpstate != null) {
      parts.push(`${ob.yearsDrivingUpstate} yrs upstate`);
    }
    const classLabel = vehicleClassLabel(ob?.vehicleClass);
    if (classLabel) parts.push(classLabel);
    return parts.length ? parts.join(' · ') : undefined;
  }, [ob?.seats, ob?.yearsDrivingUpstate, ob?.vehicleClass]);

  const showBack = editing || settingsOpen;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.topBar, { paddingTop: insets.top + space.sm }]}>
        {showBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              settingsOpen ? 'Back to profile' : 'Cancel editing'
            }
            hitSlop={12}
            disabled={saving}
            onPress={settingsOpen ? closeSettings : cancelEdit}
            style={({ pressed }) => [
              styles.iconBtn,
              pressed && styles.iconBtnPressed,
              saving && styles.iconBtnDisabled,
            ]}
          >
            <Icon icon={ChevronLeft} size="md" color={colors.inkSoft} />
          </Pressable>
        ) : (
          <View style={styles.topSpacer} />
        )}
        {!editing && !settingsOpen ? (
          <View style={styles.topActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Notification settings"
              hitSlop={12}
              onPress={openSettings}
              style={({ pressed }) => [
                styles.iconBtn,
                pressed && styles.iconBtnPressed,
              ]}
            >
              <Icon icon={Settings} size="md" color={colors.accent} />
            </Pressable>
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
          </View>
        ) : (
          <View style={styles.topSpacer} />
        )}
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: bottomNavClearance(insets.bottom) + space.lg },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
            <View>
              {settingsOpen ? (
                <View style={styles.viewBlock}>
                  <Text
                    style={styles.lead}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.8}
                  >
                    Your <Text style={styles.trail}>settings</Text>
                  </Text>
                  <Text style={styles.support}>
                    Notifications, sign out, and account.
                  </Text>

                  <View style={styles.settingsSection}>
                    <Text style={styles.settingsSectionTitle}>When you post</Text>
                    {notifLoading ? (
                      <LoadingHint label="Loading…" variant="inline" />
                    ) : (
                      <View style={styles.notifStack}>
                        <ChoiceGroup
                          label="New applications"
                          options={PREF_OPTIONS}
                          value={notifPrefs.newApplication}
                          onChange={onNewApplicationChange}
                        />
                        <Text style={styles.notifHint}>
                          Favorites only = favorited drivers who apply.
                        </Text>
                        <ChoiceGroup
                          label="Ride status changes"
                          options={DRIVE_STATUS_OPTIONS}
                          value={notifPrefs.driveStatus}
                          onChange={onDriveStatusChange}
                        />
                        <Text style={styles.notifHint}>
                          Picked up, completed, or cancelled.
                        </Text>
                        <ChoiceGroup
                          label="Cancel requests"
                          options={PREF_OPTIONS}
                          value={notifPrefs.cancelRequest}
                          onChange={onCancelRequestChange}
                        />
                        <Text style={styles.notifHint}>
                          When a driver asks to cancel. Favorites only =
                          favorited drivers.
                        </Text>
                      </View>
                    )}
                  </View>

                  <View style={styles.settingsDivider} />

                  <View style={styles.settingsSection}>
                    <Text style={styles.settingsSectionTitle}>When you drive</Text>
                    {notifLoading ? null : (
                      <View style={styles.notifStack}>
                        <ChoiceGroup
                          label="You got the job"
                          options={PREF_OPTIONS}
                          value={notifPrefs.applicationAccepted}
                          onChange={onApplicationAcceptedChange}
                        />
                        <Text style={styles.notifHint}>
                          Favorites only = favorited dispatchers.
                        </Text>
                        <ChoiceGroup
                          label="Applications cleared"
                          options={PREF_OPTIONS}
                          value={notifPrefs.applicationCleared}
                          onChange={onApplicationClearedChange}
                        />
                        <Text style={styles.notifHint}>
                          When a dispatcher clears applications on a post you
                          applied to. Favorites = favorited dispatchers.
                        </Text>
                        <ChoiceGroup
                          label="New drives posted"
                          options={PREF_OPTIONS}
                          value={notifPrefs.newDrivePosted}
                          onChange={onNewDrivePostedChange}
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
                  </View>

                  <View style={styles.settingsDivider} />

                  <View style={styles.settingsSection}>
                    <Text style={styles.settingsSectionTitle}>Account</Text>
                    <Text style={styles.notifHint}>
                      Sign out keeps your account. Delete removes it for good.
                    </Text>
                    <Button
                      variant="ghost"
                      onPress={onSignOut}
                      disabled={accountBusy}
                      accessibilityLabel="Sign out"
                    >
                      Sign out
                    </Button>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Delete account"
                      disabled={accountBusy}
                      onPress={onDeleteAccount}
                      style={({ pressed }) => [
                        styles.deleteAccountBtn,
                        (pressed || accountBusy) && styles.deleteAccountPressed,
                      ]}
                    >
                      <Text style={styles.deleteAccountLabel}>
                        {accountBusy ? 'Working…' : 'Delete account'}
                      </Text>
                    </Pressable>
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
              {editing ? (
                <Text style={styles.support}>
                  Update what other drivers see. Drive count stays automatic.
                </Text>
              ) : null}

              {!editing ? (
                <View style={[styles.viewBlock, styles.profileViewBlock]}>
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
                    detail={driverDetail}
                    notes={ob?.extraInfo}
                    showMap={false}
                  />

                  <View style={styles.historyBlock}>
                    <Text style={styles.statLabel}>Drives</Text>
                    {historyLoading ? (
                      <LoadingHint label="Loading drives…" variant="block" />
                    ) : historyError ? (
                      <Text style={styles.historyEmpty}>{historyError}</Text>
                    ) : history.length === 0 ? (
                      <Text style={styles.historyEmpty}>
                        No completed drives yet.
                      </Text>
                    ) : (
                      <View style={styles.historyList}>
                        {history.map((trip) => {
                          const when = formatWhen(
                            trip.completedAt ?? trip.createdAt,
                          );
                          const tripLabel =
                            trip.tripType === 'round_trip'
                              ? 'Round trip'
                              : 'One way';
                          const meta = [
                            when,
                            tripLabel,
                            trip.costCents != null
                              ? formatMoney(trip.costCents)
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' · ');
                          return (
                            <View key={trip.id} style={styles.historyRow}>
                              <Text
                                style={styles.historyRoute}
                                numberOfLines={2}
                              >
                                {trip.routeText}
                              </Text>
                              {meta ? (
                                <Text style={styles.historyMeta}>{meta}</Text>
                              ) : null}
                            </View>
                          );
                        })}
                      </View>
                    )}
                  </View>

                  {ob?.zelle ? (
                    <View style={styles.fieldBlock}>
                      <Text style={styles.fieldLabel}>Zelle</Text>
                      <Text style={styles.fieldValue}>{ob.zelle}</Text>
                    </View>
                  ) : null}
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
                      <View style={styles.vehiclePhotoCol}>
                        <PhotoPickerField
                          label="Exterior"
                          uri={exteriorUri}
                          onChange={setExteriorUri}
                          variant="rect"
                          compact
                        />
                      </View>
                      <View style={styles.vehiclePhotoCol}>
                        <PhotoPickerField
                          label="Interior"
                          uri={interiorUri}
                          onChange={setInteriorUri}
                          variant="rect"
                          compact
                        />
                      </View>
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
            </View>
      </ScrollView>
    </KeyboardAvoidingView>
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
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
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
  profileViewBlock: {
    marginTop: space.lg,
  },
  settingsSection: {
    gap: space.md,
    marginTop: space.sm,
  },
  settingsSectionTitle: {
    fontFamily: fonts.display,
    fontSize: 28,
    letterSpacing: -0.4,
    lineHeight: 34,
    color: colors.ink,
  },
  settingsDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hairline,
    marginVertical: space.md,
  },
  deleteAccountBtn: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.md,
  },
  deleteAccountPressed: {
    opacity: 0.7,
  },
  deleteAccountLabel: {
    fontFamily: fonts.sansSemi,
    fontSize: 15,
    letterSpacing: -0.1,
    color: colors.danger,
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
  historyBlock: {
    gap: space.sm,
  },
  historyList: {
    gap: space.sm,
  },
  historyRow: {
    gap: 4,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.field,
  },
  historyRoute: {
    fontFamily: fonts.sansSemi,
    fontSize: 16,
    letterSpacing: -0.2,
    color: colors.ink,
  },
  historyMeta: {
    ...type.caption,
    color: colors.muted,
  },
  historyEmpty: {
    ...type.body,
    color: colors.faint,
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
  vehiclePhotoCol: {
    flex: 1,
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
