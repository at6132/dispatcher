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

import { AuthProvider, useAuth } from './src/auth/AuthContext';
import type { AuthRoute } from './src/auth/types';
import { LoadingHint } from './src/components/ui/LoadingHint';
import { logger } from './src/debug/logger';
import { AuthScreen } from './src/screens/auth/AuthScreen';
import { ContactSupportScreen } from './src/screens/auth/ContactSupportScreen';
import { MainShell } from './src/screens/MainShell';
import { OnboardingScreen } from './src/screens/onboarding/OnboardingScreen';
import { colors } from './src/theme';

function Root() {
  const { status, user } = useAuth();
  const [route, setRoute] = useState<AuthRoute>('auth');

  useEffect(() => {
    if (status === 'bootstrapping') return;
    if (status === 'authenticated') {
      logger.info('nav', 'gate', {
        screen: user?.onboardingComplete ? 'main' : 'onboarding',
        onboardingComplete: user?.onboardingComplete ?? false,
        userId: user?.id,
      });
      return;
    }
    logger.info('nav', 'gate', { screen: route === 'contactSupport' ? 'support' : 'auth' });
  }, [status, user?.id, user?.onboardingComplete, route]);

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

  if (!fontsLoaded) {
    return (
      <View style={styles.boot}>
        <LoadingHint label="Loading…" variant="block" />
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <AuthProvider>
        <Root />
        <StatusBar style="light" />
      </AuthProvider>
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
