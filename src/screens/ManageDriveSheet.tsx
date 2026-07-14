import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
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

import {
  acceptApplication,
  listApplications,
  updateDrive,
  type DriveApplication,
  type DriveListItem,
} from '../api/drives';
import { mapApiError } from '../api/errors';
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
import { DriverCard } from '../components/ui/DriverCard';
import { Icon } from '../components/ui/Icon';
import { LoadingHint } from '../components/ui/LoadingHint';
import { NumberStepper } from '../components/ui/NumberStepper';
import { TextField } from '../components/ui/TextField';
import { MistBackdrop, colors, fonts, radius, space, type } from '../theme';

type ManageTab = 'applicants' | 'details';

type ManageDriveSheetProps = {
  visible: boolean;
  drive: DriveListItem | null;
  onClose: () => void;
  onChanged: () => void;
};

type TripChoice = 'one_way' | 'round_trip';

const TRIP_OPTIONS: { value: TripChoice; label: string }[] = [
  { value: 'one_way', label: 'One way' },
  { value: 'round_trip', label: 'Round trip' },
];

const TABS: { key: ManageTab; label: string }[] = [
  { key: 'applicants', label: 'Applicants' },
  { key: 'details', label: 'Details' },
];

function applicantDetail(app: DriveApplication): string | undefined {
  const years = app.driver.onboarding?.yearsDrivingUpstate;
  const seats = app.driver.onboarding?.seats;
  const parts = [
    seats != null ? `${seats} seats` : null,
    years != null ? `${years} yrs upstate` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

/**
 * Poster manage sheet — applicants + accept, or edit open-drive details.
 */
export function ManageDriveSheet({
  visible,
  drive,
  onClose,
  onChanged,
}: ManageDriveSheetProps) {
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(false);
  /** Snapshot so close animation still has drive data. */
  const [active, setActive] = useState<DriveListItem | null>(null);

  const [tab, setTab] = useState<ManageTab>('applicants');
  const [apps, setApps] = useState<DriveApplication[]>([]);
  const [appsLoading, setAppsLoading] = useState(false);
  const [appsError, setAppsError] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [phone, setPhone] = useState('');
  const [vehicleClass, setVehicleClass] = useState<VehicleClass | null>(null);
  const [seats, setSeats] = useState(4);
  const [tripType, setTripType] = useState<TripChoice | null>(null);
  const [address, setAddress] = useState('');
  const [extraInfo, setExtraInfo] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fillDetails = useCallback((d: DriveListItem) => {
    setTitle(d.routeText);
    setPhone(d.passengerPhone ? formatPhoneDisplay(d.passengerPhone) : '');
    setVehicleClass(d.vehicleClass ?? null);
    setSeats(d.seats ?? 4);
    setTripType(d.tripType ?? null);
    setAddress(d.address ?? '');
    setExtraInfo(d.extraInfo ?? '');
    setSubmitted(false);
    setSaving(false);
    setFormError(null);
  }, []);

  const loadApps = useCallback(async (driveId: string) => {
    setAppsLoading(true);
    setAppsError(null);
    try {
      const items = await listApplications(driveId);
      setApps(items.filter((a) => a.status === 'pending'));
    } catch (err) {
      setAppsError(mapApiError(err).message);
    } finally {
      setAppsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible && drive) {
      setActive(drive);
      setMounted(true);
      setTab('applicants');
      setActionError(null);
      fillDetails(drive);
      void loadApps(drive.id);
      return;
    }

    if (!visible && mounted) {
      setMounted(false);
      setActive(null);
      setApps([]);
      setAcceptingId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- visibility-driven
  }, [visible, drive?.id]);

  const requestClose = () => {
    if (saving || acceptingId) return;
    Keyboard.dismiss();
    onClose();
  };

  const onAccept = async (applicationId: string) => {
    const target = drive ?? active;
    if (!target) return;
    setActionError(null);
    setAcceptingId(applicationId);
    try {
      await acceptApplication(target.id, applicationId);
      onChanged();
      onClose();
    } catch (err) {
      setActionError(mapApiError(err).message);
      void loadApps(target.id);
    } finally {
      setAcceptingId(null);
    }
  };

  const onSaveDetails = async () => {
    const target = drive ?? active;
    if (!target) return;
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

    setSaving(true);
    try {
      await updateDrive(target.id, {
        routeText: title.trim(),
        passengerPhone: normalizePhone(phone),
        vehicleClass,
        seats,
        tripType,
        ...(address.trim() ? { address: address.trim() } : {}),
        ...(extraInfo.trim() ? { extraInfo: extraInfo.trim() } : {}),
      });
      onChanged();
      setFormError(null);
    } catch (err) {
      setFormError(mapApiError(err).message);
    } finally {
      setSaving(false);
    }
  };

  const titleError =
    submitted && title.trim().length < 2
      ? 'Enter a title like SF to Monticello'
      : undefined;
  const phoneError = submitted ? validatePhone(phone) : undefined;
  const classError =
    submitted && !vehicleClass ? 'Pick a vehicle class' : undefined;
  const tripError =
    submitted && !tripType ? 'Pick one way or round trip' : undefined;

  const busy = saving || acceptingId != null;
  const sheetDrive = drive ?? active;

  if (!sheetDrive || (!visible && !mounted)) return null;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={requestClose}
    >
      <View style={styles.root}>
        <MistBackdrop style={styles.fill} />

        <View style={styles.screen}>
          <KeyboardAvoidingView
            style={styles.flex}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={[styles.topBar, { paddingTop: insets.top + space.sm }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={12}
                disabled={busy}
                onPress={requestClose}
                style={({ pressed }) => [
                  styles.closeBtn,
                  pressed && styles.closeBtnPressed,
                  busy && styles.closeBtnDisabled,
                ]}
              >
                <Icon icon={X} size="md" color={colors.inkSoft} />
              </Pressable>
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
                <View style={styles.hero}>
                  <Text style={styles.lead}>Manage </Text>
                  <Text style={styles.trail}>drive</Text>
                </View>
                <Text style={styles.route} numberOfLines={2}>
                  {sheetDrive.routeText}
                </Text>

                <View style={styles.tabs} accessibilityRole="tablist">
                  {TABS.map((t) => {
                    const selected = tab === t.key;
                    return (
                      <Pressable
                        key={t.key}
                        accessibilityRole="tab"
                        accessibilityState={{ selected }}
                        disabled={busy}
                        onPress={() => setTab(t.key)}
                        style={[
                          styles.tab,
                          selected && styles.tabOn,
                        ]}
                      >
                        <Text
                          style={[
                            styles.tabLabel,
                            selected && styles.tabLabelOn,
                          ]}
                        >
                          {t.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </Pressable>

              {tab === 'applicants' ? (
                <View style={styles.section}>
                  {appsLoading ? (
                    <View style={styles.centered}>
                      <ActivityIndicator color={colors.accent} />
                      <LoadingHint label="Loading applicants…" />
                    </View>
                  ) : appsError ? (
                    <View style={styles.emptyBlock}>
                      <Text style={styles.emptyTitle}>Couldn’t load</Text>
                      <Text style={styles.emptyBody}>{appsError}</Text>
                      <Button
                        variant="ghost"
                        onPress={() => void loadApps(sheetDrive.id)}
                      >
                        Try again
                      </Button>
                    </View>
                  ) : apps.length === 0 ? (
                    <View style={styles.emptyBlock}>
                      <Text style={styles.emptyTitle}>No applicants yet</Text>
                      <Text style={styles.emptyBody}>
                        When drivers apply, they’ll show up here so you can pick
                        one.
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.appList}>
                      {apps.map((app) => {
                        const coord =
                          app.lat != null && app.lng != null
                            ? { latitude: app.lat, longitude: app.lng }
                            : null;
                        const accepting = acceptingId === app.id;
                        return (
                          <View key={app.id} style={styles.appRow}>
                            <DriverCard
                              name={app.driver.name}
                              vehicleType={
                                app.driver.onboarding?.vehicleType
                              }
                              phone={
                                app.driver.phone
                                  ? formatPhoneDisplay(app.driver.phone)
                                  : undefined
                              }
                              detail={applicantDetail(app)}
                              photoUri={app.driver.onboarding?.selfPhotoUri}
                              vehicleInteriorUri={
                                app.driver.onboarding?.vehicleInteriorUri
                              }
                              vehicleExteriorUri={
                                app.driver.onboarding?.vehicleExteriorUri
                              }
                              coordinate={coord}
                              showMap={Boolean(coord)}
                            />
                            <Button
                              loading={accepting}
                              disabled={busy}
                              onPress={() => void onAccept(app.id)}
                            >
                              Accept
                            </Button>
                          </View>
                        );
                      })}
                    </View>
                  )}
                  {actionError ? (
                    <Text style={styles.formError} accessibilityRole="alert">
                      {actionError}
                    </Text>
                  ) : null}
                </View>
              ) : (
                <View style={styles.section}>
                  <View style={styles.fields}>
                    <TextField
                      label="Title"
                      value={title}
                      onChangeText={setTitle}
                      placeholder="SF to Monticello"
                      autoCapitalize="words"
                      error={titleError}
                      editable={!busy}
                      returnKeyType="next"
                    />
                    <TextField
                      label="Customer phone"
                      value={formatPhoneDisplay(phone)}
                      onChangeText={(v) => setPhone(formatPhoneDisplay(v))}
                      keyboardType="phone-pad"
                      error={phoneError}
                      editable={!busy}
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
                      editable={!busy}
                    />
                    <TextField
                      label="Extra info (optional)"
                      value={extraInfo}
                      onChangeText={setExtraInfo}
                      placeholder="Anything drivers should know"
                      multiline
                      editable={!busy}
                      style={styles.extraInput}
                    />
                  </View>

                  {formError ? (
                    <Text style={styles.formError} accessibilityRole="alert">
                      {formError}
                    </Text>
                  ) : null}

                  <View style={styles.actions}>
                    <Button
                      loading={saving}
                      disabled={busy}
                      onPress={() => void onSaveDetails()}
                    >
                      Save changes
                    </Button>
                    {saving ? <LoadingHint label="Saving…" /> : null}
                  </View>
                </View>
              )}
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  fill: {
    ...StyleSheet.absoluteFillObject,
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
  route: {
    ...type.body,
    color: colors.muted,
    paddingLeft: space.xs,
    marginTop: -space.sm,
  },
  tabs: {
    flexDirection: 'row',
    gap: space.xs,
    marginTop: space.md,
    padding: 4,
    borderRadius: radius.lg,
    backgroundColor: colors.accentMuted,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.sm + 2,
    borderRadius: radius.md,
  },
  tabOn: {
    backgroundColor: colors.accentSoft,
  },
  tabLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    letterSpacing: 0.2,
    color: colors.faint,
  },
  tabLabelOn: {
    color: colors.ink,
    fontFamily: fonts.sansSemi,
  },
  section: {
    gap: space.md,
  },
  centered: {
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.xxl,
  },
  emptyBlock: {
    gap: space.sm,
    paddingVertical: space.xl,
    paddingHorizontal: space.xs,
  },
  emptyTitle: {
    ...type.title,
    color: colors.ink,
  },
  emptyBody: {
    ...type.body,
    color: colors.muted,
    maxWidth: 300,
  },
  appList: {
    gap: space.lg,
  },
  appRow: {
    gap: space.sm,
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
