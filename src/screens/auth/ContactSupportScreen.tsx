import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '../../components/ui/Button';
import { MistBackdrop, colors, space, type } from '../../theme';

type Props = {
  onBack: () => void;
};

export function ContactSupportScreen({ onBack }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <MistBackdrop>
      <View
        style={[
          styles.root,
          {
            paddingTop: insets.top + space.xxl,
            paddingBottom: insets.bottom + space.xxxl,
          },
        ]}
      >
        <View style={styles.content}>
          <Text style={styles.title}>Contact support</Text>
          <Text style={styles.body}>
            Email support@dispatcher.app with the phone number on your account.
          </Text>
          <View style={styles.bottom}>
            <Button variant="quiet" onPress={onBack}>
              Back
            </Button>
          </View>
        </View>
      </View>
    </MistBackdrop>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: space.xl,
    justifyContent: 'center',
  },
  content: {
    width: '100%',
    maxWidth: 400,
    alignSelf: 'center',
  },
  title: {
    ...type.display,
    color: colors.ink,
    marginBottom: space.lg,
  },
  body: {
    ...type.bodyLarge,
    color: colors.inkSoft,
  },
  bottom: {
    marginTop: space.xxxl,
  },
});
