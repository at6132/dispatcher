import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  BottomNav,
  type AddOrigin,
  type MainTab,
} from '../components/navigation/BottomNav';
import { MistBackdrop } from '../theme';
import { BankScreen } from './BankScreen';
import { CreateDriveSheet } from './CreateDriveSheet';
import { HomeScreen } from './HomeScreen';

/**
 * Authenticated shell after onboarding — Home / Bank + center add.
 */
export function MainShell() {
  const [tab, setTab] = useState<MainTab>('home');
  const [composeOpen, setComposeOpen] = useState(false);
  const [addOrigin, setAddOrigin] = useState<AddOrigin | null>(null);
  const [boardRefresh, setBoardRefresh] = useState(0);

  return (
    <MistBackdrop>
      <View style={styles.root}>
        <View style={styles.page}>
          {tab === 'home' ? (
            <HomeScreen refreshToken={boardRefresh} />
          ) : (
            <BankScreen />
          )}
        </View>
        <BottomNav
          active={tab}
          onChange={setTab}
          onAddPress={(origin) => {
            setAddOrigin(origin);
            setComposeOpen(true);
          }}
        />
        <CreateDriveSheet
          visible={composeOpen}
          origin={addOrigin}
          onClose={() => setComposeOpen(false)}
          onCreated={() => {
            setTab('home');
            setBoardRefresh((n) => n + 1);
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
