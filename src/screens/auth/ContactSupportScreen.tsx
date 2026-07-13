import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassSurface, colors, space, type } from '../../theme';
import { Button } from '../../components/ui/Button';

type Props = {
  onBack: () => void;
};

export function ContactSupportScreen({ onBack }: Props) {
  const insets = useSafeAreaInsets();

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
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Contact support</Text>
          <Text style={styles.subtitle}>
            Password resets aren’t available in the app yet. Reach out and we’ll
            help you get back in.
          </Text>
        </View>

        <GlassSurface style={styles.panel} flat>
          <Text style={styles.detail}>
            Email{' '}
            <Text style={styles.detailStrong}>support@dispatcher.app</Text>
            {'\n'}
            and include the phone number on your account.
          </Text>
        </GlassSurface>

        <Button variant="ghost" onPress={onBack} accessibilityLabel="Back to sign in">
          Back to sign in
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.canvas,
    paddingHorizontal: space.xl,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    gap: space.xl,
    maxWidth: 400,
    width: '100%',
    alignSelf: 'center',
  },
  header: {
    gap: space.sm,
  },
  title: {
    ...type.display,
    color: colors.ink,
  },
  subtitle: {
    ...type.body,
    color: colors.muted,
  },
  panel: {
    padding: space.xl,
  },
  detail: {
    ...type.body,
    color: colors.inkSoft,
  },
  detailStrong: {
    color: colors.accent,
    fontWeight: '600',
  },
});
