import { StyleSheet, Text, View } from 'react-native';

import {
  getConfirmMatchState,
  getPasswordRequirements,
} from '../../auth/validation';
import { colors, fonts, space, type } from '../../theme';

type RequirementsProps = {
  password: string;
  /** Show list once the user starts typing (or on focus). */
  visible?: boolean;
};

export function PasswordRequirements({
  password,
  visible = true,
}: RequirementsProps) {
  if (!visible) return null;

  const requirements = getPasswordRequirements(password);

  return (
    <View
      style={styles.list}
      accessibilityRole="summary"
      accessibilityLabel="Password requirements"
    >
      {requirements.map((req) => (
        <View key={req.id} style={styles.row}>
          <Text
            style={[styles.mark, req.met ? styles.markMet : styles.markPending]}
            accessibilityLabel={req.met ? 'Met' : 'Not met'}
          >
            {req.met ? '✓' : '○'}
          </Text>
          <Text style={[styles.text, req.met && styles.textMet]}>
            {req.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

type ConfirmProps = {
  password: string;
  confirm: string;
};

export function ConfirmPasswordStatus({ password, confirm }: ConfirmProps) {
  const state = getConfirmMatchState(password, confirm);
  if (state === 'idle') return null;

  const matched = state === 'match';

  return (
    <View style={styles.row} accessibilityLiveRegion="polite">
      <Text style={[styles.mark, matched ? styles.markMet : styles.markFail]}>
        {matched ? '✓' : '×'}
      </Text>
      <Text style={[styles.text, matched ? styles.textMet : styles.textFail]}>
        {matched ? 'Passwords match' : 'Passwords don’t match'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: space.sm,
    paddingLeft: space.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  mark: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    width: 14,
    textAlign: 'center',
  },
  markPending: {
    color: colors.faint,
  },
  markMet: {
    color: colors.success,
  },
  markFail: {
    color: colors.danger,
  },
  text: {
    ...type.caption,
    color: colors.muted,
  },
  textMet: {
    color: colors.inkSoft,
  },
  textFail: {
    color: colors.danger,
  },
});
