import { useCallback, useEffect, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Landmark } from 'lucide-react-native';

import {
  listBalances,
  settleBalance,
  type Balance,
} from '../api/balances';
import { mapApiError } from '../api/errors';
import { useAuth } from '../auth/AuthContext';
import { bottomNavClearance } from '../components/navigation/BottomNav';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';
import { LoadingHint } from '../components/ui/LoadingHint';
import { GlassSurface, colors, fonts, space, type } from '../theme';

function formatUsd(cents: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

function formatDue(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Due Sunday';
  return `Due ${d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })}`;
}

export function BankScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [items, setItems] = useState<Balance[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settlingId, setSettlingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'refresh') setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const result = await listBalances();
      setItems(result.items);
    } catch (err) {
      setError(mapApiError(err).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load('initial');
  }, [load]);

  const open = items.filter((b) => b.status === 'open');
  const owedToYouCents = open
    .filter((b) => b.posterId === user?.id)
    .reduce((sum, b) => sum + b.amountCents, 0);
  const youOweCents = open
    .filter((b) => b.driverId === user?.id)
    .reduce((sum, b) => sum + b.amountCents, 0);

  const onSettle = async (balanceId: string) => {
    setActionError(null);
    setSettlingId(balanceId);
    try {
      await settleBalance(balanceId);
      await load('refresh');
    } catch (err) {
      setActionError(mapApiError(err).message);
    } finally {
      setSettlingId(null);
    }
  };

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
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void load('refresh')}
          tintColor={colors.accent}
        />
      }
    >
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>Balances</Text>
        <Text style={styles.title}>
          <Text style={styles.titleLead}>Your </Text>
          <Text style={styles.titleItalic}>bank</Text>
        </Text>
        <Text style={styles.support}>
          10% from completed jobs. Pay outside the app, then mark settled here.
        </Text>
      </View>

      {loading && !refreshing ? (
        <LoadingHint label="Loading balances…" variant="block" />
      ) : error && items.length === 0 ? (
        <View style={styles.stateBlock}>
          <Text style={styles.errorText}>{error}</Text>
          <Button variant="ghost" onPress={() => void load('initial')}>
            Try again
          </Button>
        </View>
      ) : (
        <>
          <GlassSurface style={styles.balanceCard} contentStyle={styles.balanceInner}>
            <View style={styles.balanceHead}>
              <Icon icon={Landmark} size="md" color={colors.accent} />
              <Text style={styles.balanceEyebrow}>Open balances</Text>
            </View>
            <View style={styles.totalsRow}>
              <View style={styles.totalCol}>
                <Text style={styles.totalLabel}>Owed to you</Text>
                <Text style={styles.balanceAmount}>
                  {formatUsd(owedToYouCents)}
                </Text>
              </View>
              <View style={styles.totalCol}>
                <Text style={styles.totalLabel}>You owe</Text>
                <Text style={styles.balanceAmountSecondary}>
                  {formatUsd(youOweCents)}
                </Text>
              </View>
            </View>
          </GlassSurface>

          {actionError ? (
            <Text style={styles.actionError}>{actionError}</Text>
          ) : null}

          {open.length === 0 ? (
            <Text style={styles.empty}>No open balances.</Text>
          ) : (
            <View style={styles.list}>
              {open.map((b) => {
                const isPoster = b.posterId === user?.id;
                const isDriver = b.driverId === user?.id;
                return (
                  <GlassSurface
                    key={b.id}
                    style={styles.rowCard}
                    contentStyle={styles.rowInner}
                  >
                    <View style={styles.rowTop}>
                      <Text style={styles.rowRole}>
                        {isPoster
                          ? 'Owed to you'
                          : isDriver
                            ? 'You owe'
                            : 'Balance'}
                      </Text>
                      <Text
                        style={[
                          styles.rowAmount,
                          isPoster
                            ? styles.amountIncoming
                            : isDriver
                              ? styles.amountOutgoing
                              : null,
                        ]}
                      >
                        {formatUsd(b.amountCents)}
                      </Text>
                    </View>
                    <Text style={styles.rowDue}>{formatDue(b.dueSunday)}</Text>
                    {isPoster ? (
                      <Button
                        variant="primary"
                        loading={settlingId === b.id}
                        disabled={settlingId != null}
                        onPress={() => void onSettle(b.id)}
                        style={styles.settleBtn}
                      >
                        Got paid
                      </Button>
                    ) : (
                      <Text style={styles.rowHint}>
                        Pay the poster off-app, then they mark it settled.
                      </Text>
                    )}
                  </GlassSurface>
                );
              })}
            </View>
          )}
        </>
      )}
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
    marginBottom: space.xl,
  },
  balanceInner: {
    padding: space.xl,
    gap: space.md,
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
  totalsRow: {
    flexDirection: 'row',
    gap: space.xl,
  },
  totalCol: {
    flex: 1,
    gap: space.xs,
  },
  totalLabel: {
    ...type.caption,
    color: colors.faint,
  },
  balanceAmount: {
    fontFamily: fonts.display,
    fontSize: 36,
    letterSpacing: -1,
    lineHeight: 42,
    color: colors.success,
  },
  balanceAmountSecondary: {
    fontFamily: fonts.display,
    fontSize: 36,
    letterSpacing: -1,
    lineHeight: 42,
    color: colors.danger,
  },
  stateBlock: {
    gap: space.md,
    alignItems: 'flex-start',
    paddingLeft: space.xs,
  },
  errorText: {
    ...type.body,
    color: colors.danger,
  },
  actionError: {
    ...type.caption,
    color: colors.danger,
    marginBottom: space.md,
    paddingLeft: space.xs,
  },
  empty: {
    ...type.body,
    color: colors.muted,
    paddingLeft: space.xs,
  },
  list: {
    gap: space.md,
  },
  rowCard: {
    borderRadius: 22,
  },
  rowInner: {
    padding: space.lg,
    gap: space.sm,
  },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: space.md,
  },
  rowRole: {
    ...type.label,
    fontFamily: fonts.sansMedium,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  rowAmount: {
    fontFamily: fonts.display,
    fontSize: 28,
    letterSpacing: -0.5,
    color: colors.ink,
  },
  amountIncoming: {
    color: colors.success,
  },
  amountOutgoing: {
    color: colors.danger,
  },
  rowDue: {
    ...type.caption,
    color: colors.faint,
  },
  rowHint: {
    ...type.caption,
    color: colors.muted,
  },
  settleBtn: {
    marginTop: space.xs,
  },
});
