import { apiFetch } from './client';

export type BalanceStatus = 'open' | 'settled';

export type BalanceParty = {
  id: string;
  name: string;
  phone: string;
  zelle?: string;
};

export type Balance = {
  id: string;
  driveId: string;
  posterId: string;
  driverId: string;
  amountCents: number;
  status: BalanceStatus;
  dueSunday: string;
  settledAt?: string;
  createdAt: string;
  poster?: BalanceParty;
  driver?: BalanceParty;
};

export type ListBalancesResult = {
  items: Balance[];
  /** Lifetime 10% earned as poster — includes settled balances. */
  totalProfitCents: number;
};

export async function listBalances(): Promise<ListBalancesResult> {
  const data = await apiFetch<ListBalancesResult>('/v1/balances');
  return {
    items: data.items ?? [],
    totalProfitCents: data.totalProfitCents ?? 0,
  };
}

export async function settleBalance(
  balanceId: string,
  opts?: { settlementProofKey?: string },
): Promise<{ id: string; status: BalanceStatus; settledAt?: string }> {
  const data = await apiFetch<{
    balance: { id: string; status: BalanceStatus; settledAt?: string };
  }>(`/v1/balances/${balanceId}/settle`, {
    method: 'POST',
    body: JSON.stringify({
      ...(opts?.settlementProofKey
        ? { settlementProofKey: opts.settlementProofKey }
        : {}),
    }),
  });
  return data.balance;
}
