import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { DriveListItem } from '../api/drives';
import type { DirectSendTarget } from '../api/profiles';
import {
  BottomNav,
  type AddOrigin,
  type MainTab,
} from '../components/navigation/BottomNav';
import { ProfileViewerProvider } from '../profiles/ProfileViewerContext';
import { syncPushRegistration } from '../notifications/registerPush';
import { MistBackdrop } from '../theme';
import { BankScreen } from './BankScreen';
import { CreateDriveSheet } from './CreateDriveSheet';
import { HomeScreen } from './HomeScreen';
import { ManageDriveSheet } from './ManageDriveSheet';
import { ProfileScreen } from './ProfileScreen';
import { ProfilesScreen } from './ProfilesScreen';

/**
 * Authenticated shell after onboarding — Home / People / Bank / You + center add.
 */
export function MainShell() {
  const [tab, setTab] = useState<MainTab>('home');
  const [composeOpen, setComposeOpen] = useState(false);
  const [addOrigin, setAddOrigin] = useState<AddOrigin | null>(null);
  const [directTo, setDirectTo] = useState<DirectSendTarget | null>(null);
  const [managingDrive, setManagingDrive] = useState<DriveListItem | null>(
    null,
  );
  const [boardRefresh, setBoardRefresh] = useState(0);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    void syncPushRegistration();
  }, []);

  const bumpBoard = () => {
    setTab('home');
    setBoardRefresh((n) => n + 1);
  };

  const openCompose = (origin: AddOrigin | null, target?: DirectSendTarget) => {
    setDirectTo(target ?? null);
    setAddOrigin(origin);
    setComposeOpen(true);
  };

  return (
    <MistBackdrop>
      <ProfileViewerProvider onSendDirect={(target) => openCompose(null, target)}>
        <View style={styles.root}>
          <View style={styles.page}>
            {tab === 'home' ? (
              <HomeScreen
                refreshToken={boardRefresh}
                onManageDrive={setManagingDrive}
              />
            ) : tab === 'profiles' ? (
              <ProfilesScreen
                onSendDirect={(target) => openCompose(null, target)}
              />
            ) : (
              <BankScreen />
            )}
          </View>
          <BottomNav
            active={tab}
            onChange={(next) => {
              setProfileOpen(false);
              setTab(next);
            }}
            onAddPress={(origin) => openCompose(origin)}
            onProfilePress={() => setProfileOpen(true)}
            profileActive={profileOpen}
          />
          <CreateDriveSheet
            visible={composeOpen}
            origin={addOrigin}
            directTo={directTo}
            onClose={() => {
              setComposeOpen(false);
              setAddOrigin(null);
              setDirectTo(null);
            }}
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
      </ProfileViewerProvider>
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
