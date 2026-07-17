import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  CormorantGaramond_500Medium,
  CormorantGaramond_500Medium_Italic,
} from '@expo-google-fonts/cormorant-garamond';
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
} from '@expo-google-fonts/dm-sans';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import {
  SafeAreaProvider,
  initialWindowMetrics,
} from 'react-native-safe-area-context';

import {
  needsDevicePermissionsSetup,
} from './src/auth/devicePermissionsStore';
import { AuthProvider, useAuth } from './src/auth/AuthContext';
import type { AuthRoute } from './src/auth/types';
import { LoadingHint } from './src/components/ui/LoadingHint';
import { logger } from './src/debug/logger';
import { AuthScreen } from './src/screens/auth/AuthScreen';
import { ContactSupportScreen } from './src/screens/auth/ContactSupportScreen';
import { MainShell } from './src/screens/MainShell';
import { DevicePermissionsScreen } from './src/screens/onboarding/DevicePermissionsScreen';
import { OnboardingScreen } from './src/screens/onboarding/OnboardingScreen';
import { LocationProvider } from './src/location/LocationContext';
import { NetworkProvider } from './src/network/NetworkContext';
import { colors } from './src/theme';

function Root() {
  const { status, user } = useAuth();
  const [route, setRoute] = useState<AuthRoute>('auth');
  /** null = still checking; true = need location + notification prompts */
  const [needsDevicePerms, setNeedsDevicePerms] = useState<boolean | null>(
    null,
  );

  useEffect(() => {
    if (status !== 'authenticated' || !user?.onboardingComplete) {
      setNeedsDevicePerms(null);
      return;
    }

    let cancelled = false;
    setNeedsDevicePerms(null);
    void needsDevicePermissionsSetup().then((needs) => {
      if (!cancelled) setNeedsDevicePerms(needs);
    });
    return () => {
      cancelled = true;
    };
  }, [status, user?.id, user?.onboardingComplete]);

  useEffect(() => {
    if (status === 'bootstrapping') return;
    if (status === 'authenticated') {
      const screen = !user?.onboardingComplete
        ? 'onboarding'
        : needsDevicePerms === null
          ? 'devicePermissions.check'
          : needsDevicePerms
            ? 'devicePermissions'
            : 'main';
      logger.info('nav', 'gate', {
        screen,
        onboardingComplete: user?.onboardingComplete ?? false,
        needsDevicePerms,
        userId: user?.id,
      });
      return;
    }
    logger.info('nav', 'gate', {
      screen: route === 'contactSupport' ? 'support' : 'auth',
    });
  }, [
    status,
    user?.id,
    user?.onboardingComplete,
    needsDevicePerms,
    route,
  ]);

  if (status === 'bootstrapping') {
    return (
      <View style={styles.boot}>
        <LoadingHint label="Checking session…" variant="block" />
      </View>
    );
  }

  if (status === 'authenticated') {
    if (!user?.onboardingComplete) {
      return <OnboardingScreen />;
    }
    if (needsDevicePerms === null) {
      return (
        <View style={styles.boot}>
          <LoadingHint label="Checking session…" variant="block" />
        </View>
      );
    }
    if (needsDevicePerms) {
      return (
        <DevicePermissionsScreen
          onComplete={() => setNeedsDevicePerms(false)}
        />
      );
    }
    return <MainShell />;
  }

  if (route === 'contactSupport') {
    return <ContactSupportScreen onBack={() => setRoute('auth')} />;
  }

  return <AuthScreen onForgotPassword={() => setRoute('contactSupport')} />;
}

export default function App() {
  const [fontsLoaded] = useFonts({
    CormorantGaramond_500Medium,
    CormorantGaramond_500Medium_Italic,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
  });
  // Latch so a transient fontsLoaded=false never unmounts Root / onboarding.
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => {
    if (fontsLoaded) setFontsReady(true);
  }, [fontsLoaded]);

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <NetworkProvider>
        <AuthProvider>
          <LocationProvider>
            {fontsReady ? (
              <>
                <Root />
                <StatusBar style="light" />
              </>
            ) : (
              <View style={styles.boot}>
                <LoadingHint label="Loading…" variant="block" />
                <StatusBar style="light" />
              </View>
            )}
          </LocationProvider>
        </AuthProvider>
      </NetworkProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    backgroundColor: colors.canvas,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
