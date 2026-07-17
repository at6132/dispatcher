import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { DriveListItem } from '../api/drives';
import type { DirectSendTarget } from '../api/profiles';
import {
  BottomNav,
  type AddOrigin,
  type MainTab,
} from '../components/navigation/BottomNav';
import { MapExpandProvider } from '../components/ui/MapExpand';
import { ProfileViewerProvider } from '../profiles/ProfileViewerContext';
import { syncPushRegistration } from '../notifications/registerPush';
import { useNetwork } from '../network/NetworkContext';
import { MistBackdrop, colors, type } from '../theme';
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
  const insets = useSafeAreaInsets();
  const { isConnected } = useNetwork();
  const [tab, setTab] = useState<MainTab>('home');
  const [composeOpen, setComposeOpen] = useState(false);
  const [addOrigin, setAddOrigin] = useState<AddOrigin | null>(null);
  const [directTo, setDirectTo] = useState<DirectSendTarget | null>(null);
  const [managingDrive, setManagingDrive] = useState<DriveListItem | null>(
    null,
  );
  const [boardRefresh, setBoardRefresh] = useState(0);

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
        <MapExpandProvider>
          <View style={styles.root}>
            {!isConnected ? (
              <View
                pointerEvents="none"
                style={[styles.offlineBanner, { paddingTop: insets.top }]}
              >
                <Text style={styles.offlineText}>No connection</Text>
              </View>
            ) : null}
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
              ) : tab === 'bank' ? (
                <BankScreen />
              ) : (
                <ProfileScreen />
              )}
            </View>
            <BottomNav
              active={tab}
              onChange={setTab}
              onAddPress={(origin) => openCompose(origin)}
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
          </View>
        </MapExpandProvider>
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
  offlineBanner: {
    position: 'absolute',
    zIndex: 20,
    top: 0,
    right: 0,
    left: 0,
    alignItems: 'center',
    paddingBottom: 4,
    backgroundColor: colors.canvasDeep,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.danger,
  },
  offlineText: {
    ...type.label,
    color: colors.inkSoft,
  },
});
