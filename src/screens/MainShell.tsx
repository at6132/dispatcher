import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { DriveListItem } from '../api/drives';
import {
  BottomNav,
  type MainTab,
} from '../components/navigation/BottomNav';
import { syncPushRegistration } from '../notifications/registerPush';
import { MistBackdrop } from '../theme';
import { BankScreen } from './BankScreen';
import { CreateDriveSheet } from './CreateDriveSheet';
import { HomeScreen } from './HomeScreen';
import { ManageDriveSheet } from './ManageDriveSheet';
import { ProfileButton, ProfileScreen } from './ProfileScreen';

/**
 * Authenticated shell after onboarding — Home / Bank + center add.
 */
export function MainShell() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<MainTab>('home');
  const [composeOpen, setComposeOpen] = useState(false);
  const [managingDrive, setManagingDrive] = useState<DriveListItem | null>(
    null,
  );
  const [profileOpen, setProfileOpen] = useState(false);
  const [boardRefresh, setBoardRefresh] = useState(0);

  useEffect(() => {
    void syncPushRegistration();
  }, []);

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
        <ProfileButton
          topInset={insets.top}
          onPress={() => setProfileOpen(true)}
        />
        <BottomNav
          active={tab}
          onChange={setTab}
          onAddPress={() => setComposeOpen(true)}
        />
        <CreateDriveSheet
          visible={composeOpen}
          onClose={() => setComposeOpen(false)}
          onCreated={bumpBoard}
        />
        <ManageDriveSheet
          visible={managingDrive != null}
          drive={managingDrive}
          onClose={() => setManagingDrive(null)}
          onChanged={bumpBoard}
        />
        <ProfileScreen
          visible={profileOpen}
          onClose={() => setProfileOpen(false)}
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
