import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { mapApiError } from '../api/errors';
import { useAuth } from '../auth/AuthContext';
import { formatPhoneDisplay } from '../auth/validation';
import { bottomNavClearance } from '../components/navigation/BottomNav';
import { Button } from '../components/ui/Button';
import { DriverCard } from '../components/ui/DriverCard';
import { LoadingHint } from '../components/ui/LoadingHint';
import { DEMO_DRIVERS } from '../data/demo';
import { colors, fonts, space, type } from '../theme';

export function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const onSignOut = async () => {
    setSignOutError(null);
    setSigningOut(true);
    try {
      await signOut();
    } catch (err) {
      setSignOutError(mapApiError(err).message);
      setSigningOut(false);
    }
  };

  const onboarding = user?.onboarding;
  const youDetail = onboarding
    ? [
        onboarding.seats ? `${onboarding.seats} seats` : null,
        Number.isFinite(onboarding.yearsDrivingUpstate)
          ? `${onboarding.yearsDrivingUpstate} yrs upstate`
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : undefined;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: insets.top + space.xxl,
          paddingBottom: bottomNavClearance(insets.bottom) + space.lg,
        },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>Drivers</Text>
        <Text style={styles.title}>
          <Text style={styles.titleLead}>Near </Text>
          <Text style={styles.titleItalic}>you</Text>
        </Text>
        <Text style={styles.support}>
          Drivers nearby — demo list while the live feed is wired.
        </Text>
      </View>

      {onboarding ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Your listing</Text>
          <DriverCard
            photoUri={onboarding.selfPhotoUri}
            vehicleInteriorUri={onboarding.vehicleInteriorUri}
            vehicleExteriorUri={onboarding.vehicleExteriorUri}
            name={user?.name?.trim() || 'Driver'}
            vehicleType={onboarding.vehicleType}
            phone={user?.phone ? formatPhoneDisplay(user.phone) : undefined}
            detail={youDetail || undefined}
            showMap={false}
          />
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Nearby</Text>
        <View style={styles.list}>
          {DEMO_DRIVERS.map((driver) => (
            <DriverCard
              key={driver.id}
              name={driver.name}
              vehicleType={driver.vehicleType}
              phone={driver.phone}
              detail={driver.detail}
              photoUri={driver.photoUri}
              showMap={false}
            />
          ))}
        </View>
      </View>

      <View style={styles.footer}>
        <Button
          variant="quiet"
          loading={signingOut}
          disabled={signingOut}
          onPress={() => void onSignOut()}
        >
          Sign out
        </Button>
        {signingOut ? <LoadingHint label="Signing out…" /> : null}
        {signOutError ? (
          <Text style={styles.signOutError} accessibilityRole="alert">
            {signOutError}
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: space.xl,
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
  },
  hero: {
    gap: space.sm,
    marginBottom: space.xxl,
  },
  eyebrow: {
    ...type.label,
    color: colors.muted,
    textTransform: 'uppercase',
    paddingLeft: space.xs,
  },
  title: {
    paddingLeft: space.xs,
  },
  titleLead: {
    ...type.hero,
    color: colors.ink,
  },
  titleItalic: {
    ...type.heroItalic,
    color: colors.ink,
  },
  support: {
    ...type.body,
    color: colors.muted,
    paddingLeft: space.xs,
    maxWidth: 320,
  },
  section: {
    gap: space.md,
    marginBottom: space.xxl,
  },
  sectionLabel: {
    ...type.label,
    fontFamily: fonts.sansMedium,
    color: colors.muted,
    textTransform: 'uppercase',
    paddingLeft: space.xs,
  },
  list: {
    gap: space.md,
  },
  footer: {
    marginTop: space.sm,
    gap: space.sm,
  },
  signOutError: {
    ...type.caption,
    color: colors.danger,
    textAlign: 'center',
  },
});
