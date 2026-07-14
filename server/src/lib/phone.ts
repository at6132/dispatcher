/** Digits only — strip spaces, dashes, parens, leading +. */
export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Normalize for storage / API — mirrors Expo client rules.
 */
export function normalizePhone(value: string): string {
  const digits = digitsOnly(value);
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  return digits ? `+${digits}` : '';
}

export function isValidPhone(value: string): boolean {
  const digits = digitsOnly(value);
  if (!digits || digits.length < 10 || digits.length > 15) return false;
  if (/^0+$/.test(digits)) return false;
  return true;
}

export function passwordMeetsRequirements(value: string): boolean {
  return (
    value.length >= 8 &&
    value.length <= 128 &&
    /[A-Za-z]/.test(value) &&
    /[0-9]/.test(value)
  );
}

/** Next Sunday 23:59:59.999 America/New_York as Date (UTC instant). */
export function nextSundayDeadlineNy(from = new Date()): Date {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(from).map((p) => [p.type, p.value]),
  ) as Record<string, string>;

  const weekday = parts.weekday ?? 'Sun';
  const dayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const dow = dayMap[weekday] ?? 0;
  // Days until upcoming Sunday end. If already Sunday, use *this* Sunday night
  // unless past 23:59 — then next Sunday. For lock job we want the Sunday of
  // the current week (end of week containing `from`).
  const daysUntilSunday = dow === 0 ? 0 : 7 - dow;

  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day) + daysUntilSunday;

  // Build as NY local wall time via a UTC offset approximation using Date in TZ.
  // Use Temporal-free approach: format known NY noon then adjust.
  const approx = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  // Correct for NY offset at that calendar day via iterative format.
  for (let i = 0; i < 3; i++) {
    const ny = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
        .formatToParts(approx)
        .map((p) => [p.type, p.value]),
    ) as Record<string, string>;
    const wantY = year;
    const wantM = month;
    const wantD = day;
    const gotY = Number(ny.year);
    const gotM = Number(ny.month);
    const gotD = Number(ny.day);
    const gotH = Number(ny.hour === '24' ? '0' : ny.hour);
    const gotMin = Number(ny.minute);
    const gotSec = Number(ny.second);
    const dayDelta =
      Date.UTC(wantY, wantM - 1, wantD) - Date.UTC(gotY, gotM - 1, gotD);
    const timeDeltaMs =
      ((23 - gotH) * 3600 + (59 - gotMin) * 60 + (59 - gotSec)) * 1000 +
      (999 - approx.getUTCMilliseconds());
    approx.setTime(approx.getTime() + dayDelta + timeDeltaMs);
  }
  return approx;
}
