import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
  cancelDrive,
  clearApplications,
  listApplications,
  respondDriveCancel,
  updateDrive,
  type DriveApplication,
  type DriveListItem,
} from '../api/drives';
import { mapApiError } from '../api/errors';
import {
  favoriteProfile,
  unfavoriteProfile,
} from '../api/profiles';
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
import { DriverCard } from '../components/ui/DriverCard';
import { Icon } from '../components/ui/Icon';
import { LoadingHint } from '../components/ui/LoadingHint';
import { MapExpandProvider } from '../components/ui/MapExpand';
import { NumberStepper } from '../components/ui/NumberStepper';
import { TextField } from '../components/ui/TextField';
import {
  getLocalFavoriteIds,
  rememberProfiles,
  setLocalFavorite,
} from '../profiles/favoriteStore';
import { useProfileViewer } from '../profiles/ProfileViewerContext';
import { MistBackdrop, colors, fonts, radius, space, tripRouteColor, type } from '../theme';

type ManageTab = 'applicants' | 'status' | 'details';

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

function applicantDetail(app: DriveApplication): string | undefined {
  const o = app.driver.onboarding;
  const parts: string[] = [];
  if (app.favorited) parts.push('Favorite');
  if (o) {
    if (o.seats != null) parts.push(`${o.seats} seats`);
    if (o.yearsDrivingUpstate != null) {
      parts.push(
        `${o.yearsDrivingUpstate} yr${o.yearsDrivingUpstate === 1 ? '' : 's'} upstate`,
      );
    }
  }
  return parts.length ? parts.join(' · ') : undefined;
}

function driveStatusLabel(status: DriveListItem['status']): string {
  switch (status) {
    case 'open':
      return 'Open';
    case 'assigned':
      return 'Accepted';
    case 'picked_up':
      return 'Picked up';
    case 'completed':
      return 'Completed';
    case 'cancelled':
      return 'Cancelled';
  }
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

/**
 * Poster manage sheet — applicants / status + details.
 */
export function ManageDriveSheet({
  visible,
  drive,
  onClose,
  onChanged,
}: ManageDriveSheetProps) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { openProfile, profileOpen } = useProfileViewer();
  const [mounted, setMounted] = useState(false);
  /** Snapshot so close animation still has drive data. */
  const [active, setActive] = useState<DriveListItem | null>(null);

  const [tab, setTab] = useState<ManageTab>('applicants');
  /** Uncleared applications (pending / rejected / accepted). */
  const [apps, setApps] = useState<DriveApplication[]>([]);
  const [appsLoading, setAppsLoading] = useState(false);
  const [appsError, setAppsError] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [favoritingId, setFavoritingId] = useState<string | null>(null);
  const [localFavIds, setLocalFavIds] = useState<Set<string>>(new Set());

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
  const [cancelResponding, setCancelResponding] = useState<
    'approve' | 'deny' | null
  >(null);
  const [takingDown, setTakingDown] = useState(false);

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
      let favs = new Set<string>();
      if (user?.id) {
        favs = await getLocalFavoriteIds(user.id);
        setLocalFavIds(favs);
      }
      setApps(
        items
          .filter((a) => a.status !== 'cleared')
          .map((a) => ({
            ...a,
            favorited: Boolean(a.favorited) || favs.has(a.driver.id),
          })),
      );
      await rememberProfiles(
        items.map((a) => ({
          ...a.driver,
          favorited: Boolean(a.favorited) || favs.has(a.driver.id),
        })),
      );
    } catch (err) {
      setAppsError(mapApiError(err).message);
    } finally {
      setAppsLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    if (visible && drive) {
      setActive(drive);
      setMounted(true);
      setTab(drive.status === 'open' ? 'applicants' : 'status');
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
      setClearing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- visibility-driven
  }, [visible, drive?.id]);

  // Keep snapshot status in sync when parent refreshes the same drive.
  useEffect(() => {
    if (visible && drive) {
      setActive(drive);
      if (drive.status !== 'open' && tab === 'applicants') {
        setTab('status');
      }
    }
  }, [visible, drive, tab]);

  const openApplicantProfile = (
    driver: DriveApplication['driver'],
  ) => {
    // Never stack Modals — nested Modal + MapView freezes the app.
    onClose();
    setTimeout(() => {
      openProfile(driver.id, driver);
    }, 350);
  };

  const isFavorited = (driverId: string, appFavorited?: boolean) =>
    Boolean(appFavorited) || localFavIds.has(driverId);

  const onToggleFavorite = async (
    driver: DriveApplication['driver'],
    currentlyFavorited: boolean,
  ) => {
    if (!user?.id) return;
    setFavoritingId(driver.id);
    setActionError(null);
    const next = !currentlyFavorited;
    setLocalFavIds((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(driver.id);
      else copy.delete(driver.id);
      return copy;
    });
    setApps((prev) =>
      prev.map((a) =>
        a.driver.id === driver.id ? { ...a, favorited: next } : a,
      ),
    );
    try {
      await setLocalFavorite(user.id, driver.id, next);
      await rememberProfiles([{ ...driver, favorited: next }]);
      if (next) await favoriteProfile(driver.id);
      else await unfavoriteProfile(driver.id);
    } catch (err) {
      setLocalFavIds((prev) => {
        const copy = new Set(prev);
        if (currentlyFavorited) copy.add(driver.id);
        else copy.delete(driver.id);
        return copy;
      });
      setApps((prev) =>
        prev.map((a) =>
          a.driver.id === driver.id
            ? { ...a, favorited: currentlyFavorited }
            : a,
        ),
      );
      setActionError(mapApiError(err).message);
    } finally {
      setFavoritingId(null);
    }
  };

  const requestClose = () => {
    if (saving || acceptingId || clearing || takingDown) return;
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

  const onClearSubmissions = async () => {
    const target = drive ?? active;
    const clearable = apps.filter(
      (a) => a.status === 'pending' || a.status === 'rejected',
    );
    if (!target || clearable.length === 0) return;
    setActionError(null);
    setClearing(true);
    try {
      await clearApplications(target.id);
      setApps([]);
      onChanged();
    } catch (err) {
      setActionError(mapApiError(err).message);
      void loadApps(target.id);
    } finally {
      setClearing(false);
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

  const onCancelRespond = async (approve: boolean) => {
    const target = drive ?? active;
    if (!target) return;
    setActionError(null);
    setCancelResponding(approve ? 'approve' : 'deny');
    try {
      const updated = await respondDriveCancel(target.id, approve);
      setActive((prev) =>
        prev
          ? {
              ...prev,
              ...updated,
              poster: prev.poster,
              assignee: prev.assignee,
              assigneeLat: prev.assigneeLat,
              assigneeLng: prev.assigneeLng,
            }
          : prev,
      );
      onChanged();
      if (approve) onClose();
    } catch (err) {
      setActionError(mapApiError(err).message);
    } finally {
      setCancelResponding(null);
    }
  };

  const onTakeDown = () => {
    const target = drive ?? active;
    if (!target) return;
    const hasDriver =
      target.status === 'assigned' || target.status === 'picked_up';
    Alert.alert(
      'Take down this post?',
      hasDriver
        ? 'The driver will be notified and the ride will be cancelled.'
        : 'It leaves the board. Drivers can no longer apply.',
      [
        { text: 'Keep post', style: 'cancel' },
        {
          text: 'Take down',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setActionError(null);
              setTakingDown(true);
              try {
                await cancelDrive(target.id);
                onChanged();
                onClose();
              } catch (err) {
                setActionError(mapApiError(err).message);
              } finally {
                setTakingDown(false);
              }
            })();
          },
        },
      ],
    );
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

  const busy =
    saving ||
    acceptingId != null ||
    clearing ||
    cancelResponding != null ||
    takingDown;
  const sheetDrive = drive ?? active;

  if (!sheetDrive || (!visible && !mounted)) return null;

  const isOpen = sheetDrive.status === 'open';
  const canTakeDown =
    sheetDrive.status === 'open' ||
    sheetDrive.status === 'assigned' ||
    sheetDrive.status === 'picked_up';
  const cancelPending = Boolean(sheetDrive.cancelRequestedAt);
  const pendingApps = apps.filter((a) => a.status === 'pending');
  const openSubmissions = apps.filter(
    (a) => a.status === 'pending' || a.status === 'rejected',
  );
  const detailsLocked =
    !isOpen || openSubmissions.length > 0;
  const tabs: { key: ManageTab; label: string }[] = isOpen
    ? [
        { key: 'applicants', label: 'Applicants' },
        { key: 'details', label: 'Details' },
      ]
    : [
        { key: 'status', label: 'Status' },
        { key: 'details', label: 'Details' },
      ];

  const acceptedApp = apps.find((a) => a.status === 'accepted');
  const statusDriver = sheetDrive.assignee ?? acceptedApp?.driver;
  const statusCoord =
    sheetDrive.assigneeLat != null && sheetDrive.assigneeLng != null
      ? {
          latitude: sheetDrive.assigneeLat,
          longitude: sheetDrive.assigneeLng,
        }
      : acceptedApp?.lat != null && acceptedApp?.lng != null
        ? { latitude: acceptedApp.lat, longitude: acceptedApp.lng }
        : null;
  const profitCents =
    sheetDrive.status === 'completed' && sheetDrive.costCents != null
      ? Math.round(sheetDrive.costCents * 0.12)
      : null;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={requestClose}
    >
      <MapExpandProvider>
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
                <Text
                  style={[
                    styles.route,
                    { color: tripRouteColor(sheetDrive.status) },
                  ]}
                  numberOfLines={2}
                >
                  {sheetDrive.routeText}
                </Text>

                <View style={styles.tabs} accessibilityRole="tablist">
                  {tabs.map((t) => {
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

              {tab === 'applicants' && isOpen ? (
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
                  ) : pendingApps.length === 0 ? (
                    <View style={styles.emptyBlock}>
                      <Text style={styles.emptyTitle}>No applicants yet</Text>
                      <Text style={styles.emptyBody}>
                        When drivers apply, they’ll show up here so you can pick
                        one.
                      </Text>
                      {openSubmissions.length > 0 ? (
                        <View style={styles.clearBlock}>
                          <Button
                            variant="ghost"
                            loading={clearing}
                            disabled={busy}
                            onPress={() => void onClearSubmissions()}
                          >
                            Clear submissions
                          </Button>
                          <Text style={styles.clearHint}>
                            Clear so you can edit details. Drivers must apply
                            again.
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  ) : (
                    <View style={styles.appList}>
                      {pendingApps.map((app) => {
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
                              notes={app.driver.onboarding?.extraInfo}
                              photoUri={app.driver.onboarding?.selfPhotoUri}
                              vehicleInteriorUri={
                                app.driver.onboarding?.vehicleInteriorUri
                              }
                              vehicleExteriorUri={
                                app.driver.onboarding?.vehicleExteriorUri
                              }
                              coordinate={coord}
                              showMap={!profileOpen && Boolean(coord)}
                              availability={
                                app.driver.availability ?? 'offline'
                              }
                              midJob={app.midJob}
                              favorited={isFavorited(
                                app.driver.id,
                                app.favorited,
                              )}
                              favoriting={favoritingId === app.driver.id}
                              onToggleFavorite={() =>
                                void onToggleFavorite(
                                  app.driver,
                                  isFavorited(app.driver.id, app.favorited),
                                )
                              }
                              onPress={() => openApplicantProfile(app.driver)}
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
                      <View style={styles.clearBlock}>
                        <Button
                          variant="ghost"
                          loading={clearing}
                          disabled={busy}
                          onPress={() => void onClearSubmissions()}
                        >
                          Clear submissions
                        </Button>
                        <Text style={styles.clearHint}>
                          Clears everyone so you can edit details. Applicants
                          tap Apply again on the open board.
                        </Text>
                      </View>
                    </View>
                  )}
                  {actionError ? (
                    <Text style={styles.formError} accessibilityRole="alert">
                      {actionError}
                    </Text>
                  ) : null}
                  {canTakeDown ? (
                    <View style={styles.takeDownBlock}>
                      <Button
                        variant="danger"
                        loading={takingDown}
                        disabled={busy}
                        onPress={onTakeDown}
                      >
                        Take down
                      </Button>
                    </View>
                  ) : null}
                </View>
              ) : tab === 'status' && !isOpen ? (
                <View style={styles.section}>
                  <View style={styles.statusCard}>
                    <Text style={styles.statusEyebrow}>Ride status</Text>
                    <Text style={styles.statusValue}>
                      {cancelPending
                        ? 'Cancel requested'
                        : driveStatusLabel(sheetDrive.status)}
                    </Text>
                    {sheetDrive.status === 'completed' &&
                    sheetDrive.costCents != null ? (
                      <Text style={styles.statusMeta}>
                        Profit {formatMoney(sheetDrive.costCents)}
                      </Text>
                    ) : null}
                  </View>

                  {cancelPending &&
                  (sheetDrive.status === 'assigned' ||
                    sheetDrive.status === 'picked_up') ? (
                    <View style={styles.cancelBanner}>
                      <Text style={styles.cancelTitle}>Driver wants to cancel</Text>
                      <Text style={styles.cancelBody}>
                        Approve to end the ride, or keep it if they should stay
                        on the job.
                      </Text>
                      <View style={styles.cancelActions}>
                        <Button
                          loading={cancelResponding === 'approve'}
                          disabled={busy}
                          onPress={() => void onCancelRespond(true)}
                        >
                          Approve cancel
                        </Button>
                        <Button
                          variant="ghost"
                          loading={cancelResponding === 'deny'}
                          disabled={busy}
                          onPress={() => void onCancelRespond(false)}
                        >
                          Keep ride
                        </Button>
                      </View>
                    </View>
                  ) : null}

                  {profitCents != null ? (
                    <View style={styles.profitCard}>
                      <Text style={styles.statusEyebrow}>Your cut</Text>
                      <Text style={styles.profitValue}>
                        {formatMoney(profitCents)}
                      </Text>
                      <Text style={styles.statusMeta}>
                        12% dispatcher commission — settle off-app in Bank
                      </Text>
                    </View>
                  ) : null}

                  {statusDriver ? (
                    <View style={styles.statusDriver}>
                      <Text style={styles.statusEyebrow}>Driver</Text>
                      <DriverCard
                        name={statusDriver.name}
                        vehicleType={statusDriver.onboarding?.vehicleType}
                        phone={
                          acceptedApp?.driver.phone
                            ? formatPhoneDisplay(acceptedApp.driver.phone)
                            : undefined
                        }
                        detail={applicantDetail(
                          acceptedApp ?? {
                            id: '',
                            status: 'accepted',
                            createdAt: '',
                            driver: statusDriver,
                            favorited: isFavorited(statusDriver.id),
                          },
                        )}
                        notes={statusDriver.onboarding?.extraInfo}
                        photoUri={statusDriver.onboarding?.selfPhotoUri}
                        vehicleInteriorUri={
                          statusDriver.onboarding?.vehicleInteriorUri
                        }
                        vehicleExteriorUri={
                          statusDriver.onboarding?.vehicleExteriorUri
                        }
                        coordinate={statusCoord}
                        showMap={!profileOpen && Boolean(statusCoord)}
                        availability={statusDriver.availability ?? 'offline'}
                        favorited={isFavorited(
                          statusDriver.id,
                          acceptedApp?.favorited,
                        )}
                        favoriting={favoritingId === statusDriver.id}
                        onToggleFavorite={() =>
                          void onToggleFavorite(
                            {
                              ...statusDriver,
                              ...(acceptedApp?.driver.phone
                                ? { phone: acceptedApp.driver.phone }
                                : {}),
                            },
                            isFavorited(
                              statusDriver.id,
                              acceptedApp?.favorited,
                            ),
                          )
                        }
                        onPress={() => openApplicantProfile(statusDriver)}
                      />
                    </View>
                  ) : (
                    <View style={styles.emptyBlock}>
                      <Text style={styles.emptyTitle}>No driver assigned</Text>
                      <Text style={styles.emptyBody}>
                        This drive doesn’t have an assigned driver yet.
                      </Text>
                    </View>
                  )}
                  {canTakeDown ? (
                    <View style={styles.takeDownBlock}>
                      <Button
                        variant="danger"
                        loading={takingDown}
                        disabled={busy}
                        onPress={onTakeDown}
                      >
                        Take down
                      </Button>
                    </View>
                  ) : null}
                  {actionError && !isOpen ? (
                    <Text style={styles.formError} accessibilityRole="alert">
                      {actionError}
                    </Text>
                  ) : null}
                </View>
              ) : (
                <View style={styles.section}>
                  {detailsLocked ? (
                    <View style={styles.lockBanner}>
                      <Text style={styles.lockTitle}>
                        {isOpen
                          ? 'Details locked while people have applied'
                          : 'Details can’t be edited after assign'}
                      </Text>
                      <Text style={styles.lockBody}>
                        {isOpen
                          ? 'Clear submissions first — then edit. Applicants will need to apply again.'
                          : 'Route and passenger details stay as they were when the drive was open.'}
                      </Text>
                      {isOpen && openSubmissions.length > 0 ? (
                        <Button
                          variant="ghost"
                          loading={clearing}
                          disabled={busy}
                          onPress={() => void onClearSubmissions()}
                        >
                          Clear submissions
                        </Button>
                      ) : null}
                    </View>
                  ) : null}

                  <View
                    style={[styles.fields, detailsLocked && styles.fieldsLocked]}
                    pointerEvents={detailsLocked ? 'none' : 'auto'}
                  >
                    <TextField
                      label="Title"
                      value={title}
                      onChangeText={setTitle}
                      placeholder="SF to Monticello"
                      autoCapitalize="words"
                      error={titleError}
                      editable={!busy && !detailsLocked}
                      returnKeyType="next"
                    />
                    <TextField
                      label="Customer phone"
                      value={formatPhoneDisplay(phone)}
                      onChangeText={(v) => setPhone(formatPhoneDisplay(v))}
                      keyboardType="phone-pad"
                      error={phoneError}
                      editable={!busy && !detailsLocked}
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
                      editable={!busy && !detailsLocked}
                    />
                    <TextField
                      label="Extra info (optional)"
                      value={extraInfo}
                      onChangeText={setExtraInfo}
                      placeholder="Anything drivers should know"
                      multiline
                      editable={!busy && !detailsLocked}
                      style={styles.extraInput}
                    />
                  </View>

                  {formError ? (
                    <Text style={styles.formError} accessibilityRole="alert">
                      {formError}
                    </Text>
                  ) : null}

                  {!detailsLocked ? (
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
                  ) : null}
                  {actionError && isOpen ? (
                    <Text style={styles.formError} accessibilityRole="alert">
                      {actionError}
                    </Text>
                  ) : null}
                </View>
              )}
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </View>
      </MapExpandProvider>
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
    color: colors.ink,
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
  clearBlock: {
    gap: space.xs,
    paddingTop: space.sm,
  },
  clearHint: {
    ...type.caption,
    color: colors.faint,
    textAlign: 'center',
  },
  takeDownBlock: {
    paddingTop: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.glassBorder,
    marginTop: space.sm,
  },
  fields: {
    gap: space.lg,
  },
  fieldsLocked: {
    opacity: 0.55,
  },
  lockBanner: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.accentMuted,
  },
  lockTitle: {
    fontFamily: fonts.sansSemi,
    fontSize: 15,
    letterSpacing: -0.1,
    color: colors.ink,
  },
  lockBody: {
    ...type.caption,
    color: colors.muted,
  },
  statusCard: {
    gap: space.xs,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glass,
  },
  cancelBanner: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(208, 138, 138, 0.4)',
    backgroundColor: 'rgba(208, 138, 138, 0.1)',
  },
  cancelTitle: {
    fontFamily: fonts.sansSemi,
    fontSize: 16,
    letterSpacing: -0.2,
    color: colors.ink,
  },
  cancelBody: {
    ...type.caption,
    color: colors.muted,
  },
  cancelActions: {
    gap: space.sm,
    marginTop: space.xs,
  },
  profitCard: {
    gap: space.xs,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(127, 168, 148, 0.35)',
    backgroundColor: 'rgba(127, 168, 148, 0.12)',
  },
  statusEyebrow: {
    ...type.label,
    color: colors.faint,
    textTransform: 'uppercase',
  },
  statusValue: {
    fontFamily: fonts.display,
    fontSize: 32,
    letterSpacing: -0.5,
    lineHeight: 36,
    color: colors.ink,
  },
  profitValue: {
    fontFamily: fonts.display,
    fontSize: 36,
    letterSpacing: -0.6,
    lineHeight: 40,
    color: colors.success,
  },
  statusMeta: {
    ...type.caption,
    color: colors.muted,
  },
  statusDriver: {
    gap: space.sm,
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
