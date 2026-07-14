import { apiFetch } from './client';

export type BalanceStatus = 'open' | 'settled';

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
};

export type ListBalancesResult = {
  items: Balance[];
};

export async function listBalances(): Promise<ListBalancesResult> {
  const data = await apiFetch<ListBalancesResult>('/v1/balances');
  return { items: data.items ?? [] };
}

export async function settleBalance(
  balanceId: string,
): Promise<{ id: string; status: BalanceStatus; settledAt?: string }> {
  const data = await apiFetch<{
    balance: { id: string; status: BalanceStatus; settledAt?: string };
  }>(`/v1/balances/${balanceId}/settle`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
  return data.balance;
}
