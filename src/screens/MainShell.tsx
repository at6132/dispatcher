import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  BottomNav,
  type MainTab,
} from '../components/navigation/BottomNav';
import { MistBackdrop } from '../theme';
import { BankScreen } from './BankScreen';
import { HomeScreen } from './HomeScreen';

/**
 * Authenticated shell after onboarding — Home / Bank + center add.
 * Tabs are local state for now; no backend wiring.
 */
export function MainShell() {
  const [tab, setTab] = useState<MainTab>('home');

  return (
    <MistBackdrop>
      <View style={styles.root}>
        <View style={styles.page}>
          {tab === 'home' ? <HomeScreen /> : <BankScreen />}
        </View>
        <BottomNav
          active={tab}
          onChange={setTab}
          onAddPress={() => {
            // Wire to create-drive / availability flow later
          }}
        />
      </View>
    </MistBackdrop>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  page: {
    flex: 1,
  },
});
