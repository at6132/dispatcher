import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { markDevicePermissionsComplete } from '../../auth/devicePermissionsStore';
import { Button } from '../../components/ui/Button';
import {
  LocationAccessPrompt,
  isLocationAccessReady,
  type LocationAccessState,
} from '../../components/ui/LocationAccessPrompt';
import {
  NotificationAccessPrompt,
  isNotificationAccessReady,
  type NotificationAccessState,
} from '../../components/ui/NotificationAccessPrompt';
import { logger } from '../../debug/logger';
import { syncPushRegistration } from '../../notifications/registerPush';
import { MistBackdrop, colors, fonts, space, type } from '../../theme';

type Step = 0 | 1;

const STEP_COPY: Record<
  Step,
  { lead: string; trail: string; body: string }
> = {
  0: {
    lead: 'Allow',
    trail: 'location',
    body: 'Used when you apply for a ride or share availability. Your exact location is not shown on the board.',
  },
  1: {
    lead: 'Allow',
    trail: 'notifications',
    body:
      Platform.OS === 'web'
        ? 'Push alerts aren’t available in the browser yet. You can continue and use the phone app for job notifications.'
        : 'Hear about job offers, ride updates, and balances when the app is closed.',
  },
};

type Props = {
  onComplete: () => void;
};

/**
 * Location + notification prompts for returning drivers on a new install/device.
 * Full profile onboarding is skipped — only OS access for this phone.
 */
export function DevicePermissionsScreen({ onComplete }: Props) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>(0);
  const [locationAccess, setLocationAccess] =
    useState<LocationAccessState>('unknown');
  const [notificationAccess, setNotificationAccess] =
    useState<NotificationAccessState>('unknown');
  const [formError, setFormError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);

  const copy = STEP_COPY[step];

  const finish = async () => {
    setFinishing(true);
    try {
      await markDevicePermissionsComplete();
      void syncPushRegistration();
      logger.info('devicePermissions', 'complete', { notificationAccess });
      onComplete();
    } catch (err) {
      setFinishing(false);
      logger.error('devicePermissions', 'complete.fail', {
        err: err instanceof Error ? err.message : String(err),
      });
      setFormError('Couldn’t save. Try again.');
    }
  };

  const goNext = () => {
    if (finishing) return;

    if (step === 0) {
      if (!isLocationAccessReady(locationAccess)) {
        logger.info('devicePermissions', 'location_blocked', { locationAccess });
        setFormError(
          'Allow location to continue. Use the button above or open Settings.',
        );
        return;
      }
      setFormError(null);
      setStep(1);
      logger.info('devicePermissions', 'step', { from: 0, to: 1 });
      return;
    }

    // Notifications optional — continue even if denied.
    void finish();
  };

  const goBack = () => {
    if (finishing || step === 0) return;
    setFormError(null);
    setStep(0);
  };

  return (
    <MistBackdrop>
      <View
        style={[
          styles.screen,
          {
            paddingTop: insets.top + space.lg,
            paddingBottom: insets.bottom + space.lg,
          },
        ]}
      >
        <View style={styles.stage}>
          <View style={styles.top}>
            <View style={styles.progressRow}>
              {[0, 1].map((n) => (
                <View
                  key={n}
                  style={[
                    styles.progressDot,
                    n <= step && styles.progressDotActive,
                  ]}
                />
              ))}
            </View>

            <View style={styles.header}>
              <Text style={styles.lead}>{copy.lead}</Text>
              <Text style={styles.trail}>{copy.trail}</Text>
              <Text style={styles.body}>{copy.body}</Text>
            </View>

            <View style={styles.form}>
              {step === 0 ? (
                <LocationAccessPrompt onAccessChange={setLocationAccess} />
              ) : (
                <NotificationAccessPrompt
                  onAccessChange={setNotificationAccess}
                />
              )}

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
              loading={finishing}
              disabled={finishing}
              accessibilityLabel={step === 1 ? 'Finish' : 'Continue'}
            >
              {step === 0
                ? isLocationAccessReady(locationAccess)
                  ? 'Continue'
                  : 'Allow location to continue'
                : isNotificationAccessReady(notificationAccess)
                  ? 'Continue'
                  : 'Skip for now'}
            </Button>

            {step > 0 ? (
              <Pressable
                onPress={goBack}
                disabled={finishing}
                hitSlop={10}
                style={[styles.back, finishing && styles.backDisabled]}
              >
                <Text style={styles.backLabel}>Back</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </MistBackdrop>
  );
}

const styles = StyleSheet.create({
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
