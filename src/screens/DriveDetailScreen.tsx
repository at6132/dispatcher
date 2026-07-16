import { useCallback, useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  applyToDrive,
  completeDrive,
  getDrive,
  type Drive,
  type PublicProfile,
} from '../api/drives';
import { getProfile } from '../api/profiles';
import { mapApiError } from '../api/errors';
import { useAuth } from '../auth/AuthContext';
import { formatPhoneDisplay } from '../auth/validation';
import { Button } from '../components/ui/Button';
import { getCachedCoordinate } from '../components/ui/getCachedCoordinate';
import { LoadingHint } from '../components/ui/LoadingHint';
import { TextField } from '../components/ui/TextField';
import { colors, fonts, space, tripRouteColor, type } from '../theme';

type DriveDetailScreenProps = {
  driveId: string;
  onBack: () => void;
  onChanged?: () => void;
};

function statusCopy(status: Drive['status']): string {
  switch (status) {
    case 'open':
      return 'Open on the board';
    case 'assigned':
      return 'Accepted — waiting for pickup';
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

export function DriveDetailScreen({
  driveId,
  onBack,
  onChanged,
}: DriveDetailScreenProps) {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [drive, setDrive] = useState<Drive | null>(null);
  const [poster, setPoster] = useState<PublicProfile | null>(null);
  const [assignee, setAssignee] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [profitDollars, setProfitDollars] = useState('');

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const d = await getDrive(driveId);
      setDrive(d);
      const [p, a] = await Promise.all([
        getProfile(d.posterId).catch(() => null),
        d.assigneeId
          ? getProfile(d.assigneeId).catch(() => null)
          : Promise.resolve(null),
      ]);
      setPoster(p);
      setAssignee(a);
    } catch (err) {
      setError(mapApiError(err).message);
    } finally {
      setLoading(false);
    }
  }, [driveId]);

  useEffect(() => {
    void load();
  }, [load]);

  const isPoster = user?.id != null && drive?.posterId === user.id;
  const isAssignee = user?.id != null && drive?.assigneeId === user.id;
  const appStatus = drive?.viewerApplicationStatus;
  const hasApplied = appStatus === 'pending' || appStatus === 'accepted';
  const canApplyAgain = appStatus === 'cleared';
  const canApply =
    drive?.status === 'open' &&
    user?.id != null &&
    !isPoster &&
    !hasApplied &&
    appStatus !== 'rejected';
  const canComplete =
    drive?.status === 'picked_up' && (isPoster || isAssignee);

  const onApply = async () => {
    if (!drive) return;
    setActionError(null);
    setApplying(true);
    try {
      const coords = await getCachedCoordinate();
      await applyToDrive(drive.id, coords ?? undefined);
      await load();
      onChanged?.();
    } catch (err) {
      setActionError(mapApiError(err).message);
    } finally {
      setApplying(false);
    }
  };

  const onComplete = async () => {
    if (!drive) return;
    const cleaned = profitDollars.trim().replace(/[$,\s]/g, '');
    const dollars = Number.parseFloat(cleaned);
    if (!Number.isFinite(dollars) || dollars < 0) {
      setActionError('Enter the profit in dollars.');
      return;
    }
    const costCents = Math.round(dollars * 100);
    setActionError(null);
    setCompleting(true);
    try {
      await completeDrive(drive.id, { costCents });
      await load();
      onChanged?.();
    } catch (err) {
      setActionError(mapApiError(err).message);
    } finally {
      setCompleting(false);
    }
  };

  const placeLine =
    drive?.fromPlace || drive?.toPlace
      ? [drive.fromPlace, drive.toPlace].filter(Boolean).join(' → ')
      : undefined;

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + space.xl,
            paddingBottom: insets.bottom + space.xxl,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Button variant="quiet" onPress={onBack}>
          Back
        </Button>

        {loading ? (
          <LoadingHint label="Loading drive…" variant="block" />
        ) : error ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Couldn’t load</Text>
            <Text style={styles.emptyBody}>{error}</Text>
            <Button variant="ghost" onPress={() => void load()}>
              Try again
            </Button>
          </View>
        ) : drive ? (
          <>
            <View style={styles.hero}>
              <Text style={styles.eyebrow}>{statusCopy(drive.status)}</Text>
              <Text style={[styles.title, { color: tripRouteColor(drive.status) }]}>
                {drive.routeText}
              </Text>
              {placeLine ? (
                <Text style={styles.support}>{placeLine}</Text>
              ) : null}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionLabel}>People</Text>
              <Text style={styles.row}>
                Posted by{' '}
                <Text style={styles.rowStrong}>
                  {isPoster ? 'you' : poster?.name?.trim() || 'Driver'}
                </Text>
              </Text>
              {drive.assigneeId ? (
                <Text style={styles.row}>
                  Driver{' '}
                  <Text style={styles.rowStrong}>
                    {isAssignee ? 'you' : assignee?.name?.trim() || 'Driver'}
                  </Text>
                </Text>
              ) : null}
            </View>

            {drive.passengerPhone || drive.address ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Passenger</Text>
                {drive.passengerPhone ? (
                  <Text style={styles.row}>
                    {formatPhoneDisplay(drive.passengerPhone)}
                  </Text>
                ) : null}
                {drive.address ? (
                  <Text style={styles.rowMuted}>{drive.address}</Text>
                ) : null}
              </View>
            ) : null}

            {drive.status === 'completed' && drive.costCents != null ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Profit</Text>
                <Text style={styles.rowStrong}>
                  {formatMoney(drive.costCents)}
                </Text>
              </View>
            ) : null}

            {canApply ? (
              <View style={styles.actions}>
                <Button
                  loading={applying}
                  disabled={applying}
                  onPress={() => void onApply()}
                >
                  {canApplyAgain ? 'Apply again' : 'Apply for this drive'}
                </Button>
              </View>
            ) : null}

            {drive.status === 'open' && hasApplied && !isPoster ? (
              <Text style={styles.hint}>You’ve applied for this drive.</Text>
            ) : null}

            {drive.status === 'open' && isPoster ? (
              <Text style={styles.hint}>
                Waiting for drivers to apply. You’ll pick one from applications.
              </Text>
            ) : null}

            {canComplete ? (
              <View style={styles.actions}>
                <Text style={styles.sectionLabel}>Complete</Text>
                <TextField
                  label="Profit ($)"
                  value={profitDollars}
                  onChangeText={setProfitDollars}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  editable={!completing}
                />
                <Button
                  loading={completing}
                  disabled={completing}
                  onPress={() => void onComplete()}
                >
                  Mark complete
                </Button>
              </View>
            ) : null}

            {actionError ? (
              <Text style={styles.error} accessibilityRole="alert">
                {actionError}
              </Text>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scroll: {
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
    gap: space.sm,
    marginTop: space.sm,
  },
  eyebrow: {
    ...type.label,
    color: colors.muted,
    textTransform: 'uppercase',
    paddingLeft: space.xs,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 36,
    letterSpacing: -0.6,
    lineHeight: 42,
    color: colors.ink,
    paddingLeft: space.xs,
  },
  support: {
    ...type.body,
    color: colors.muted,
    paddingLeft: space.xs,
  },
  section: {
    gap: space.sm,
  },
  sectionLabel: {
    ...type.label,
    fontFamily: fonts.sansMedium,
    color: colors.muted,
    textTransform: 'uppercase',
    paddingLeft: space.xs,
  },
  row: {
    ...type.body,
    color: colors.inkSoft,
    paddingLeft: space.xs,
  },
  rowStrong: {
    fontFamily: fonts.sansSemi,
    color: colors.ink,
  },
  rowMuted: {
    ...type.body,
    color: colors.muted,
    paddingLeft: space.xs,
  },
  actions: {
    gap: space.md,
    marginTop: space.sm,
  },
  hint: {
    ...type.caption,
    color: colors.muted,
    paddingLeft: space.xs,
  },
  error: {
    ...type.caption,
    color: colors.danger,
    textAlign: 'center',
  },
  empty: {
    gap: space.md,
    paddingTop: space.xxl,
    alignItems: 'flex-start',
  },
  emptyTitle: {
    ...type.title,
    color: colors.ink,
  },
  emptyBody: {
    ...type.body,
    color: colors.muted,
  },
});
