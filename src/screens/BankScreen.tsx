import { useCallback, useEffect, useState } from 'react';
import {
  Linking,
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
  type Balance,
  type BalanceParty,
  type PlatformFee,
} from '../api/balances';
import { mapApiError } from '../api/errors';
import { useAuth } from '../auth/AuthContext';
import { formatPhoneDisplay } from '../auth/validation';
import { bottomNavClearance } from '../components/navigation/BottomNav';
import { Button } from '../components/ui/Button';
import { Icon } from '../components/ui/Icon';
import { LoadingHint } from '../components/ui/LoadingHint';
import {
  SettlePaidModal,
  type SettlePaidTarget,
} from '../components/ui/SettlePaidModal';
import { GlassSurface, colors, fonts, space, type } from '../theme';

type OweGroup = {
  key: string;
  party: BalanceParty;
  amountCents: number;
  tripCount: number;
  dueSunday: string;
  balanceIds: string[];
  status: 'open' | 'payment_pending';
  settlementProofUrl?: string;
};

type PlatformFeeGroup = {
  key: string;
  amountCents: number;
  tripCount: number;
  dueSunday: string;
  feeIds: string[];
  status: 'open' | 'payment_pending';
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

function groupUnsettledBalances(
  items: Balance[],
  side: 'youOwe' | 'owedToYou',
  userId: string | undefined,
): OweGroup[] {
  if (!userId) return [];

  const map = new Map<string, OweGroup>();

  for (const b of items) {
    if (b.status === 'settled') continue;

    if (side === 'youOwe') {
      if (b.driverId !== userId) continue;
      const party = b.poster ?? {
        id: b.posterId,
        name: 'Dispatcher',
        phone: '',
      };
      const key = `${party.id}:${b.status}`;
      const existing = map.get(key);
      if (existing) {
        existing.amountCents += b.amountCents;
        existing.tripCount += 1;
        existing.dueSunday = earliestDue(existing.dueSunday, b.dueSunday);
        existing.balanceIds.push(b.id);
        existing.settlementProofUrl ??= b.settlementProofUrl;
      } else {
        map.set(key, {
          key,
          party,
          amountCents: b.amountCents,
          tripCount: 1,
          dueSunday: b.dueSunday,
          balanceIds: [b.id],
          status: b.status,
          settlementProofUrl: b.settlementProofUrl,
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
    const key = `${party.id}:${b.status}`;
    const existing = map.get(key);
    if (existing) {
      existing.amountCents += b.amountCents;
      existing.tripCount += 1;
      existing.dueSunday = earliestDue(existing.dueSunday, b.dueSunday);
      existing.balanceIds.push(b.id);
      existing.settlementProofUrl ??= b.settlementProofUrl;
    } else {
      map.set(key, {
        key,
        party,
        amountCents: b.amountCents,
        tripCount: 1,
        dueSunday: b.dueSunday,
        balanceIds: [b.id],
        status: b.status,
        settlementProofUrl: b.settlementProofUrl,
      });
    }
  }

  return [...map.values()].sort((a, b) => b.amountCents - a.amountCents);
}

function groupPlatformFees(fees: PlatformFee[]): PlatformFeeGroup[] {
  const map = new Map<string, PlatformFeeGroup>();
  for (const f of fees) {
    if (f.status === 'settled') continue;
    const existing = map.get(f.status);
    if (existing) {
      existing.amountCents += f.amountCents;
      existing.tripCount += 1;
      existing.dueSunday = earliestDue(existing.dueSunday, f.dueSunday);
      existing.feeIds.push(f.id);
    } else {
      map.set(f.status, {
        key: f.status,
        amountCents: f.amountCents,
        tripCount: 1,
        dueSunday: f.dueSunday,
        feeIds: [f.id],
        status: f.status,
      });
    }
  }
  return [...map.values()].sort((a, b) => {
    if (a.status === b.status) return b.amountCents - a.amountCents;
    return a.status === 'open' ? -1 : 1;
  });
}

export function BankScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [items, setItems] = useState<Balance[]>([]);
  const [platformFees, setPlatformFees] = useState<PlatformFee[]>([]);
  const [totalProfitCents, setTotalProfitCents] = useState(0);
  const [owedToUsCents, setOwedToUsCents] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settleTarget, setSettleTarget] = useState<SettlePaidTarget | null>(
    null,
  );

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'refresh') setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const result = await listBalances();
      setItems(result.items);
      setPlatformFees(result.platformFees);
      setTotalProfitCents(result.totalProfitCents);
      setOwedToUsCents(result.owedToUsCents);
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

  const youOweGroups = groupUnsettledBalances(items, 'youOwe', user?.id);
  const owedToYouGroups = groupUnsettledBalances(
    items,
    'owedToYou',
    user?.id,
  );
  const owedToUsGroups = groupPlatformFees(platformFees);

  const owedToYouCents = owedToYouGroups.reduce(
    (sum, g) => sum + g.amountCents,
    0,
  );
  const youOweCents = youOweGroups.reduce((sum, g) => sum + g.amountCents, 0);

  const openSettlementAction = (
    group: OweGroup,
    action: 'markPaid' | 'confirmReceived',
  ) => {
    setSettleTarget({
      key: group.key,
      name: group.party.name,
      amountLabel: formatUsd(group.amountCents),
      tripLabel: formatTrips(group.tripCount),
      balanceIds: group.balanceIds,
      action,
      kind: 'balance',
    });
  };

  const openPlatformFeeAction = (group: PlatformFeeGroup) => {
    setSettleTarget({
      key: `platform:${group.key}`,
      name: 'Platform',
      amountLabel: formatUsd(group.amountCents),
      tripLabel: formatTrips(group.tripCount),
      balanceIds: group.feeIds,
      action: 'markPaid',
      kind: 'platformFee',
    });
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
          Drivers pay you 12%. Remit 2% to the platform — you keep 10%.
        </Text>
      </View>

      {loading && !refreshing ? (
        <LoadingHint label="Loading balances…" variant="block" />
      ) : error && items.length === 0 && platformFees.length === 0 ? (
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
              <Text style={styles.profitHint}>
                Settled 12% received minus 2% you’ve paid the platform
              </Text>
            </View>
            <View style={styles.totalsDivider} />
            <View style={styles.totalsRow}>
              <View style={styles.totalCol}>
                <Text style={styles.totalLabel}>Owed to you</Text>
                <Text style={styles.totalIncoming}>
                  {formatUsd(owedToYouCents)}
                </Text>
              </View>
              <View style={styles.totalCol}>
                <Text style={styles.totalLabel}>You owe</Text>
                <Text style={styles.totalOutgoing}>
                  {formatUsd(youOweCents)}
                </Text>
              </View>
            </View>
            <View style={styles.totalsDivider} />
            <View style={styles.totalCol}>
              <Text style={styles.totalLabel}>Owed to us</Text>
              <Text style={styles.totalOutgoing}>
                {formatUsd(owedToUsCents)}
              </Text>
            </View>
          </GlassSurface>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Owed to us</Text>
            {owedToUsGroups.length === 0 ? (
              <Text style={styles.empty}>Nothing outstanding.</Text>
            ) : (
              <View style={styles.list}>
                {owedToUsGroups.map((g) => (
                  <GlassSurface
                    key={g.key}
                    style={styles.rowCard}
                    contentStyle={styles.rowInner}
                  >
                    <View style={styles.rowTop}>
                      <View style={styles.rowIdentity}>
                        <Text style={styles.rowName}>Platform fee</Text>
                        <Text style={styles.rowMeta}>
                          {formatTrips(g.tripCount)} · {formatDue(g.dueSunday)}
                        </Text>
                      </View>
                      <Text style={[styles.rowAmount, styles.amountOutgoing]}>
                        {formatUsd(g.amountCents)}
                      </Text>
                    </View>
                    <Text style={styles.rowHint}>
                      {g.status === 'payment_pending'
                        ? 'Sent — waiting for confirmation that we received it.'
                        : '2% of trip cost. Send off-app, then mark sent with an optional screenshot.'}
                    </Text>
                    {g.status === 'open' ? (
                      <Button
                        variant="primary"
                        onPress={() => openPlatformFeeAction(g)}
                        style={styles.settleBtn}
                      >
                        Mark sent
                      </Button>
                    ) : (
                      <Text style={styles.pendingLabel}>Pending confirmation</Text>
                    )}
                  </GlassSurface>
                ))}
              </View>
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>You owe</Text>
            {youOweGroups.length === 0 ? (
              <Text style={styles.empty}>Nothing outstanding.</Text>
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
                      <Text style={[styles.rowAmount, styles.amountOutgoing]}>
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
                      {g.status === 'payment_pending'
                        ? `Payment pending — waiting for ${g.party.name} to confirm they received it.`
                        : 'Pay 12% off-app, then mark paid. Optional confirmation screenshot.'}
                    </Text>
                    {g.status === 'open' ? (
                      <Button
                        variant="primary"
                        onPress={() => openSettlementAction(g, 'markPaid')}
                        style={styles.settleBtn}
                      >
                        Mark paid
                      </Button>
                    ) : (
                      <Text style={styles.pendingLabel}>Pending confirmation</Text>
                    )}
                  </GlassSurface>
                ))}
              </View>
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Owed to you</Text>
            {owedToYouGroups.length === 0 ? (
              <Text style={styles.empty}>Nothing outstanding.</Text>
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
                      <Text style={[styles.rowAmount, styles.amountIncoming]}>
                        {formatUsd(g.amountCents)}
                      </Text>
                    </View>
                    {g.party.phone ? (
                      <Text style={styles.rowDetail}>
                        {formatPhoneDisplay(g.party.phone)}
                      </Text>
                    ) : null}
                    <Text style={styles.rowHint}>
                      {g.status === 'payment_pending'
                        ? `${g.party.name} marked this paid. Confirm after the money reaches you. Remit 2% to the platform from Owed to us.`
                        : `Waiting for ${g.party.name} to mark the 12% payment paid.`}
                    </Text>
                    {g.status === 'payment_pending' ? (
                      <>
                        {g.settlementProofUrl ? (
                          <Button
                            variant="ghost"
                            onPress={() =>
                              void Linking.openURL(g.settlementProofUrl!)
                            }
                            style={styles.settleBtn}
                          >
                            View payment confirmation
                          </Button>
                        ) : null}
                        <Button
                          variant="primary"
                          onPress={() =>
                            openSettlementAction(g, 'confirmReceived')
                          }
                          style={styles.settleBtn}
                        >
                          Mark received
                        </Button>
                      </>
                    ) : (
                      <Text style={styles.pendingLabel}>Awaiting payment</Text>
                    )}
                  </GlassSurface>
                ))}
              </View>
            )}
          </View>
        </>
      )}

      <SettlePaidModal
        visible={settleTarget != null}
        target={settleTarget}
        onClose={() => setSettleTarget(null)}
        onSettled={() => {
          setSettleTarget(null);
          void load('refresh');
        }}
      />
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
  totalIncoming: {
    fontFamily: fonts.display,
    fontSize: 28,
    letterSpacing: -0.5,
    lineHeight: 34,
    color: colors.success,
  },
  totalOutgoing: {
    fontFamily: fonts.display,
    fontSize: 28,
    letterSpacing: -0.5,
    lineHeight: 34,
    color: colors.danger,
  },
  amountIncoming: {
    color: colors.success,
  },
  amountOutgoing: {
    color: colors.danger,
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
  pendingLabel: {
    ...type.label,
    color: colors.accent,
    marginTop: space.xs,
    textTransform: 'uppercase',
  },
});
