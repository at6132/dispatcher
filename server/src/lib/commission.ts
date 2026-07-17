/** Driver pays dispatcher this share of trip cost. */
export const DRIVER_COMMISSION_RATE = 0.12;

/** Dispatcher remits this share of trip cost to the platform. */
export const PLATFORM_FEE_RATE = 0.02;

/**
 * Poster keeps this share after remitting the platform fee
 * (commission − platform = 0.10). Literal — do not subtract floats
 * (0.12 - 0.02 → 0.0999… breaks PG integer param inference).
 */
export const POSTER_KEEP_RATE = 0.1;

/** Driver keeps this share after paying the poster commission. */
export const DRIVER_KEEP_RATE = 0.88;

export function driverCommissionCents(costCents: number): number {
  return Math.round(costCents * DRIVER_COMMISSION_RATE);
}

export function platformFeeCents(costCents: number): number {
  return Math.round(costCents * PLATFORM_FEE_RATE);
}

export function posterKeepCents(costCents: number): number {
  return Math.round(costCents * POSTER_KEEP_RATE);
}

export function driverKeepCents(costCents: number): number {
  return Math.round(costCents * DRIVER_KEEP_RATE);
}
