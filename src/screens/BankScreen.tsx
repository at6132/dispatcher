import { Landmark } from 'lucide-react-native';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { bottomNavClearance } from '../components/navigation/BottomNav';
import { Icon } from '../components/ui/Icon';
import { DEMO_BANK } from '../data/demo';
import { GlassSurface, colors, fonts, space, type } from '../theme';

function formatUsd(cents: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function BankScreen() {
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: insets.top + space.xxl,
          paddingBottom: bottomNavClearance(insets.bottom) + space.lg,
        },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>Payouts</Text>
        <Text style={styles.title}>
          <Text style={styles.titleLead}>Your </Text>
          <Text style={styles.titleItalic}>bank</Text>
        </Text>
        <Text style={styles.support}>
          Demo balances — not connected to Stripe yet.
        </Text>
      </View>

      <GlassSurface style={styles.balanceCard} contentStyle={styles.balanceInner}>
        <View style={styles.balanceHead}>
          <Icon icon={Landmark} size="md" color={colors.accent} />
          <Text style={styles.balanceEyebrow}>Available</Text>
        </View>
        <Text style={styles.balanceAmount}>
          {formatUsd(DEMO_BANK.availableCents)}
        </Text>
        <Text style={styles.pending}>
          {formatUsd(DEMO_BANK.pendingCents)} pending
        </Text>
      </GlassSurface>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: space.xl,
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
  },
  hero: {
    gap: space.sm,
    marginBottom: space.xxl,
  },
  eyebrow: {
    ...type.label,
    color: colors.muted,
    textTransform: 'uppercase',
    paddingLeft: space.xs,
  },
  title: {
    paddingLeft: space.xs,
  },
  titleLead: {
    ...type.hero,
    color: colors.ink,
  },
  titleItalic: {
    ...type.heroItalic,
    color: colors.ink,
  },
  support: {
    ...type.body,
    color: colors.muted,
    paddingLeft: space.xs,
    maxWidth: 320,
  },
  balanceCard: {
    borderRadius: 28,
  },
  balanceInner: {
    padding: space.xl,
    gap: space.sm,
  },
  balanceHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  balanceEyebrow: {
    ...type.label,
    fontFamily: fonts.sansMedium,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  balanceAmount: {
    fontFamily: fonts.display,
    fontSize: 48,
    letterSpacing: -1,
    lineHeight: 54,
    color: colors.ink,
  },
  pending: {
    ...type.caption,
    color: colors.faint,
  },
});
