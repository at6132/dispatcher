import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { DriveListItem } from '../api/drives';
import {
  BottomNav,
  type AddOrigin,
  type MainTab,
} from '../components/navigation/BottomNav';
import { MistBackdrop } from '../theme';
import { BankScreen } from './BankScreen';
import { CreateDriveSheet } from './CreateDriveSheet';
import { HomeScreen } from './HomeScreen';
import { ManageDriveSheet } from './ManageDriveSheet';

/**
 * Authenticated shell after onboarding — Home / Bank + center add.
 */
export function MainShell() {
  const [tab, setTab] = useState<MainTab>('home');
  const [composeOpen, setComposeOpen] = useState(false);
  const [addOrigin, setAddOrigin] = useState<AddOrigin | null>(null);
  const [managingDrive, setManagingDrive] = useState<DriveListItem | null>(
    null,
  );
  const [boardRefresh, setBoardRefresh] = useState(0);

  const bumpBoard = () => {
    setTab('home');
    setBoardRefresh((n) => n + 1);
  };

  return (
    <MistBackdrop>
      <View style={styles.root}>
        <View style={styles.page}>
          {tab === 'home' ? (
            <HomeScreen
              refreshToken={boardRefresh}
              onManageDrive={setManagingDrive}
            />
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
          onClose={() => {
            setComposeOpen(false);
            setAddOrigin(null);
          }}
          onCreated={bumpBoard}
        />
        <ManageDriveSheet
          visible={managingDrive != null}
          drive={managingDrive}
          onClose={() => setManagingDrive(null)}
          onChanged={bumpBoard}
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
