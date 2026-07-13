import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../auth/AuthContext';
import { GlassSurface, colors, space, type } from '../theme';
import { Button } from '../components/ui/Button';

/** Temporary post-auth shell so the sign-in loop is testable. */
export function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: insets.top + space.xxl,
          paddingBottom: insets.bottom + space.xxl,
        },
      ]}
    >
      <GlassSurface style={styles.panel} flat>
        <Text style={styles.title}>You’re in</Text>
        <Text style={styles.subtitle}>
          {user?.name ? `${user.name} · ` : ''}
          {user?.phone ?? ''}
        </Text>
        <Button variant="ghost" onPress={() => void signOut()}>
          Sign out
        </Button>
      </GlassSurface>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.canvas,
    paddingHorizontal: space.xl,
    justifyContent: 'center',
  },
  panel: {
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
    padding: space.xl,
    gap: space.md,
  },
  title: {
    ...type.title,
    color: colors.ink,
  },
  subtitle: {
    ...type.body,
    color: colors.muted,
  },
});
