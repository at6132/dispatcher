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
  type BalanceParty,
} from '../api/balances';
import { mapApiError } from '../api/errors';
import { useAuth } from '../auth/AuthContext';
import { formatPhoneDisplay } from '../auth/validation';
import { bottomNavClearance } from '../components/navigation/BottomNav';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';
import { LoadingHint } from '../components/ui/LoadingHint';
import { GlassSurface, colors, fonts, space, type } from '../theme';

type OweGroup = {
  key: string;
  party: BalanceParty;
  amountCents: number;
  tripCount: number;
  dueSunday: string;
  balanceIds: string[];
};

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

function formatTrips(count: number) {
  return count === 1 ? '1 trip' : `${count} trips`;
}

function earliestDue(a: string, b: string) {
  return new Date(a).getTime() <= new Date(b).getTime() ? a : b;
}

function groupOpenBalances(
  items: Balance[],
  side: 'youOwe' | 'owedToYou',
  userId: string | undefined,
): OweGroup[] {
  if (!userId) return [];

  const map = new Map<string, OweGroup>();

  for (const b of items) {
    if (b.status !== 'open') continue;

    if (side === 'youOwe') {
      if (b.driverId !== userId) continue;
      const party = b.poster ?? {
        id: b.posterId,
        name: 'Dispatcher',
        phone: '',
      };
      const existing = map.get(party.id);
      if (existing) {
        existing.amountCents += b.amountCents;
        existing.tripCount += 1;
        existing.dueSunday = earliestDue(existing.dueSunday, b.dueSunday);
        existing.balanceIds.push(b.id);
      } else {
        map.set(party.id, {
          key: party.id,
          party,
          amountCents: b.amountCents,
          tripCount: 1,
          dueSunday: b.dueSunday,
          balanceIds: [b.id],
        });
      }
      continue;
    }

    if (b.posterId !== userId) continue;
    const party = b.driver ?? {
      id: b.driverId,
      name: 'Driver',
      phone: '',
    };
    const existing = map.get(party.id);
    if (existing) {
      existing.amountCents += b.amountCents;
      existing.tripCount += 1;
      existing.dueSunday = earliestDue(existing.dueSunday, b.dueSunday);
      existing.balanceIds.push(b.id);
    } else {
      map.set(party.id, {
        key: party.id,
        party,
        amountCents: b.amountCents,
        tripCount: 1,
        dueSunday: b.dueSunday,
        balanceIds: [b.id],
      });
    }
  }

  return [...map.values()].sort((a, b) => b.amountCents - a.amountCents);
}

export function BankScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [items, setItems] = useState<Balance[]>([]);
  const [totalProfitCents, setTotalProfitCents] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settlingKey, setSettlingKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'refresh') setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const result = await listBalances();
      setItems(result.items);
      setTotalProfitCents(result.totalProfitCents);
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

  const youOweGroups = groupOpenBalances(items, 'youOwe', user?.id);
  const owedToYouGroups = groupOpenBalances(items, 'owedToYou', user?.id);

  const owedToYouCents = owedToYouGroups.reduce(
    (sum, g) => sum + g.amountCents,
    0,
  );
  const youOweCents = youOweGroups.reduce((sum, g) => sum + g.amountCents, 0);

  const onSettleGroup = async (group: OweGroup) => {
    setActionError(null);
    setSettlingKey(group.key);
    try {
      for (const id of group.balanceIds) {
        await settleBalance(id);
      }
      await load('refresh');
    } catch (err) {
      setActionError(mapApiError(err).message);
      await load('refresh');
    } finally {
      setSettlingKey(null);
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
              <Text style={styles.balanceEyebrow}>Bank</Text>
            </View>
            <View style={styles.profitBlock}>
              <Text style={styles.totalLabel}>Total profit</Text>
              <Text style={styles.balanceAmount}>
                {formatUsd(totalProfitCents)}
              </Text>
              <Text style={styles.profitHint}>Includes settled</Text>
            </View>
            <View style={styles.totalsDivider} />
            <View style={styles.totalsRow}>
              <View style={styles.totalCol}>
                <Text style={styles.totalLabel}>Owed to you</Text>
                <Text style={styles.balanceAmountSecondary}>
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

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>You owe</Text>
            {youOweGroups.length === 0 ? (
              <Text style={styles.empty}>Nothing open.</Text>
            ) : (
              <View style={styles.list}>
                {youOweGroups.map((g) => (
                  <GlassSurface
                    key={g.key}
                    style={styles.rowCard}
                    contentStyle={styles.rowInner}
                  >
                    <View style={styles.rowTop}>
                      <View style={styles.rowIdentity}>
                        <Text style={styles.rowName}>{g.party.name}</Text>
                        <Text style={styles.rowMeta}>
                          {formatTrips(g.tripCount)} · {formatDue(g.dueSunday)}
                        </Text>
                      </View>
                      <Text style={styles.rowAmount}>
                        {formatUsd(g.amountCents)}
                      </Text>
                    </View>
                    {g.party.phone ? (
                      <Text style={styles.rowDetail}>
                        {formatPhoneDisplay(g.party.phone)}
                      </Text>
                    ) : null}
                    {g.party.zelle ? (
                      <Text style={styles.rowDetail}>Zelle {g.party.zelle}</Text>
                    ) : null}
                    <Text style={styles.rowHint}>
                      Pay off-app. They mark it settled.
                    </Text>
                  </GlassSurface>
                ))}
              </View>
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Owed to you</Text>
            {owedToYouGroups.length === 0 ? (
              <Text style={styles.empty}>Nothing open.</Text>
            ) : (
              <View style={styles.list}>
                {owedToYouGroups.map((g) => (
                  <GlassSurface
                    key={g.key}
                    style={styles.rowCard}
                    contentStyle={styles.rowInner}
                  >
                    <View style={styles.rowTop}>
                      <View style={styles.rowIdentity}>
                        <Text style={styles.rowName}>{g.party.name}</Text>
                        <Text style={styles.rowMeta}>
                          {formatTrips(g.tripCount)} · {formatDue(g.dueSunday)}
                        </Text>
                      </View>
                      <Text style={styles.rowAmount}>
                        {formatUsd(g.amountCents)}
                      </Text>
                    </View>
                    {g.party.phone ? (
                      <Text style={styles.rowDetail}>
                        {formatPhoneDisplay(g.party.phone)}
                      </Text>
                    ) : null}
                    <Button
                      variant="primary"
                      loading={settlingKey === g.key}
                      disabled={settlingKey != null}
                      onPress={() => void onSettleGroup(g)}
                      style={styles.settleBtn}
                    >
                      Got paid
                    </Button>
                  </GlassSurface>
                ))}
              </View>
            )}
          </View>
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
  profitBlock: {
    gap: space.xs,
  },
  profitHint: {
    ...type.caption,
    color: colors.faint,
  },
  totalsDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hairline,
    marginVertical: space.xs,
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
    color: colors.ink,
  },
  balanceAmountSecondary: {
    fontFamily: fonts.display,
    fontSize: 28,
    letterSpacing: -0.5,
    lineHeight: 34,
    color: colors.muted,
  },
  section: {
    gap: space.md,
    marginBottom: space.xxl,
  },
  sectionLabel: {
    ...type.label,
    fontFamily: fonts.sansMedium,
    color: colors.muted,
    textTransform: 'uppercase',
    paddingLeft: space.xs,
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
    alignItems: 'flex-start',
    gap: space.md,
  },
  rowIdentity: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  rowName: {
    ...type.title,
    color: colors.ink,
  },
  rowMeta: {
    ...type.caption,
    color: colors.faint,
  },
  rowAmount: {
    fontFamily: fonts.display,
    fontSize: 28,
    letterSpacing: -0.5,
    color: colors.ink,
  },
  rowDetail: {
    ...type.caption,
    color: colors.muted,
  },
  rowHint: {
    ...type.caption,
    color: colors.faint,
  },
  settleBtn: {
    marginTop: space.xs,
  },
});
