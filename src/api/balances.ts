import { apiFetch } from './client';

export type BalanceStatus = 'open' | 'payment_pending' | 'settled';

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
  paidAt?: string;
  settledAt?: string;
  settlementProofUrl?: string;
  createdAt: string;
  poster?: BalanceParty;
  driver?: BalanceParty;
};

export type PlatformFee = {
  id: string;
  driveId: string;
  balanceId?: string;
  posterId: string;
  amountCents: number;
  status: BalanceStatus;
  dueSunday: string;
  paidAt?: string;
  settledAt?: string;
  settlementProofUrl?: string;
  createdAt: string;
};

export type ListBalancesResult = {
  items: Balance[];
  platformFees: PlatformFee[];
  owedToUsCents: number;
  /** Settled 12% received minus settled 2% remitted to platform. */
  totalProfitCents: number;
};

type BalanceActionResult = {
  id: string;
  status: BalanceStatus;
  paidAt?: string | null;
  settledAt?: string | null;
};

export async function listBalances(): Promise<ListBalancesResult> {
  const data = await apiFetch<ListBalancesResult>('/v1/balances');
  return {
    items: data.items ?? [],
    platformFees: data.platformFees ?? [],
    owedToUsCents: data.owedToUsCents ?? 0,
    totalProfitCents: data.totalProfitCents ?? 0,
  };
}

export async function markBalancePaid(
  balanceId: string,
  opts?: { settlementProofKey?: string },
): Promise<BalanceActionResult> {
  const data = await apiFetch<{ balance: BalanceActionResult }>(
    `/v1/balances/${balanceId}/mark-paid`,
    {
      method: 'POST',
      body: JSON.stringify({
        ...(opts?.settlementProofKey
          ? { settlementProofKey: opts.settlementProofKey }
          : {}),
      }),
    },
  );
  return data.balance;
}

export async function confirmBalanceReceived(
  balanceId: string,
): Promise<BalanceActionResult> {
  const data = await apiFetch<{ balance: BalanceActionResult }>(
    `/v1/balances/${balanceId}/confirm-received`,
    {
      method: 'POST',
      body: JSON.stringify({}),
    },
  );
  return data.balance;
}

export async function markPlatformFeePaid(
  feeId: string,
  opts?: { settlementProofKey?: string },
): Promise<BalanceActionResult> {
  const data = await apiFetch<{ platformFee: BalanceActionResult }>(
    `/v1/platform-fees/${feeId}/mark-paid`,
    {
      method: 'POST',
      body: JSON.stringify({
        ...(opts?.settlementProofKey
          ? { settlementProofKey: opts.settlementProofKey }
          : {}),
      }),
    },
  );
  return data.platformFee;
}
