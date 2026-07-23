import { eq } from 'drizzle-orm';

import { db } from '../db/client.js';
import { appSettings } from '../db/schema.js';
import { safeEqual } from '../lib/crypto.js';
import { AppError } from '../lib/errors.js';

export const SIGNUP_PIN_KEY = 'signup_pin';

const PIN_RE = /^\d{4,8}$/;

export function normalizeSignupPin(raw: string): string {
  return raw.trim();
}

export function validateSignupPinFormat(pin: string): string | undefined {
  if (!pin) return 'Enter a signup PIN';
  if (!PIN_RE.test(pin)) return 'PIN must be 4–8 digits';
  return undefined;
}

export async function getSignupPin(): Promise<string | null> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, SIGNUP_PIN_KEY))
    .limit(1);
  return row?.value ?? null;
}

export async function setSignupPin(raw: string): Promise<string> {
  const pin = normalizeSignupPin(raw);
  const formatError = validateSignupPinFormat(pin);
  if (formatError) {
    throw new AppError(400, formatError, 'invalid_signup_pin');
  }

  await db
    .insert(appSettings)
    .values({ key: SIGNUP_PIN_KEY, value: pin, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: pin, updatedAt: new Date() },
    });

  return pin;
}

/** Reject signup unless the submitted PIN matches the admin-configured value. */
export async function assertSignupPin(raw: string | undefined): Promise<void> {
  const expected = await getSignupPin();
  if (!expected) {
    throw new AppError(
      403,
      'Signup is not open yet. Ask an admin for the PIN.',
      'signup_pin_unset',
    );
  }

  const submitted = normalizeSignupPin(raw ?? '');
  if (!submitted || !safeEqual(submitted, expected)) {
    throw new AppError(403, 'Wrong signup PIN.', 'invalid_signup_pin');
  }
}
