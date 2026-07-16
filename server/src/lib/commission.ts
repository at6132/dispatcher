/** Driver pays dispatcher this share of trip cost. */
export const DRIVER_COMMISSION_RATE = 0.12;

/** Dispatcher remits this share of trip cost to the platform. */
export const PLATFORM_FEE_RATE = 0.02;

export function driverCommissionCents(costCents: number): number {
  return Math.round(costCents * DRIVER_COMMISSION_RATE);
}

export function platformFeeCents(costCents: number): number {
  return Math.round(costCents * PLATFORM_FEE_RATE);
}
