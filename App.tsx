import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  SafeAreaProvider,
  initialWindowMetrics,
} from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from './src/auth/AuthContext';
import type { AuthRoute } from './src/auth/types';
import { AuthScreen } from './src/screens/auth/AuthScreen';
import { ContactSupportScreen } from './src/screens/auth/ContactSupportScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { colors } from './src/theme';

function Root() {
  const { status } = useAuth();
  const [route, setRoute] = useState<AuthRoute>('auth');

  if (status === 'bootstrapping') {
    return (
      <View style={styles.boot}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (status === 'authenticated') {
    return <HomeScreen />;
  }

  if (route === 'contactSupport') {
    return <ContactSupportScreen onBack={() => setRoute('auth')} />;
  }

  return <AuthScreen onForgotPassword={() => setRoute('contactSupport')} />;
}

export default function App() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <AuthProvider>
        <Root />
        <StatusBar style="dark" />
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
