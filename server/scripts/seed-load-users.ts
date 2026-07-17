/**
 * Seed onboarded load-test users and mint long-lived access JWTs.
 *
 * Usage (from server/):
 *   npx tsx scripts/seed-load-users.ts
 *
 * Env:
 *   DATABASE_URL, JWT_ACCESS_SECRET
 *   LOAD_DRIVERS=2000 LOAD_DISPATCHERS=500 (optional)
 *
 * Writes: ../load/tokens/drivers.json + ../load/tokens/dispatchers.json
 */
import 'dotenv/config';

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { SignJWT } from 'jose';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tokensDir = path.resolve(__dirname, '../../load/tokens');

const DRIVER_COUNT = Number(process.env.LOAD_DRIVERS ?? 2000);
const DISPATCHER_COUNT = Number(process.env.LOAD_DISPATCHERS ?? 500);
const BATCH = 250;
/** Dummy hash — bots authenticate via minted JWT, never password login. */
const PASSWORD_HASH = 'load-test-placeholder-hash';

type Role = 'driver' | 'dispatcher';

type TokenRow = {
  id: string;
  phone: string;
  name: string;
  role: Role;
  token: string;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

function phoneFor(role: Role, n: number): string {
  const base = role === 'driver' ? 555_010_0000 : 555_020_0000;
  return `+1${base + n}`;
}

async function mintToken(
  secret: Uint8Array,
  userId: string,
  phone: string,
): Promise<string> {
  return new SignJWT({ phone })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(secret);
}

async function upsertBatch(
  sql: postgres.Sql,
  secret: Uint8Array,
  role: Role,
  start: number,
  count: number,
): Promise<TokenRow[]> {
  const ids: string[] = [];
  const phones: string[] = [];
  const names: string[] = [];

  for (let i = 0; i < count; i++) {
    const n = start + i;
    ids.push(randomUUID());
    phones.push(phoneFor(role, n));
    names.push(role === 'driver' ? `Load Driver ${n}` : `Load Dispatcher ${n}`);
  }

  const users = await sql<{ id: string; phone: string; name: string }[]>`
    insert into users (id, phone, name, password_hash, status, onboarding_complete)
    select t.id, t.phone, t.name, ${PASSWORD_HASH}, 'active'::user_status, true
    from unnest(
      ${ids}::uuid[],
      ${phones}::text[],
      ${names}::text[]
    ) as t(id, phone, name)
    on conflict (phone) do update set
      name = excluded.name,
      status = 'active',
      onboarding_complete = true,
      updated_at = now()
    returning id, phone, name
  `;

  const userIds = users.map((u) => u.id);
  const availability = role === 'driver' ? 'available' : 'offline';

  await sql`
    insert into driver_profiles (
      user_id, vehicle_class, vehicle_type, seats,
      years_driving_upstate, availability, updated_at
    )
    select t.user_id, 'sedan'::vehicle_class, 'Load Test Sedan', 4,
      5, ${availability}::driver_availability, now()
    from unnest(${userIds}::uuid[]) as t(user_id)
    on conflict (user_id) do update set
      availability = excluded.availability,
      updated_at = now()
  `;

  const rows: TokenRow[] = [];
  for (const user of users) {
    rows.push({
      id: user.id,
      phone: user.phone,
      name: user.name,
      role,
      token: await mintToken(secret, user.id, user.phone),
    });
  }
  return rows;
}

async function seedRole(
  sql: postgres.Sql,
  secret: Uint8Array,
  role: Role,
  total: number,
): Promise<TokenRow[]> {
  const out: TokenRow[] = [];
  for (let start = 1; start <= total; start += BATCH) {
    const count = Math.min(BATCH, total - start + 1);
    const batch = await upsertBatch(sql, secret, role, start, count);
    out.push(...batch);
    console.log(`  ${role}: ${out.length}/${total}`);
  }
  return out;
}

async function main() {
  const databaseUrl = requireEnv('DATABASE_URL');
  const jwtSecret = requireEnv('JWT_ACCESS_SECRET');
  if (jwtSecret.length < 32) {
    throw new Error('JWT_ACCESS_SECRET must be at least 32 characters');
  }

  console.log(
    `Seeding ${DRIVER_COUNT} drivers + ${DISPATCHER_COUNT} dispatchers…`,
  );

  const sql = postgres(databaseUrl, {
    max: 4,
    prepare: false,
    connect_timeout: 30,
  });
  const secret = new TextEncoder().encode(jwtSecret);

  try {
    const drivers = await seedRole(sql, secret, 'driver', DRIVER_COUNT);
    const dispatchers = await seedRole(
      sql,
      secret,
      'dispatcher',
      DISPATCHER_COUNT,
    );

    await mkdir(tokensDir, { recursive: true });
    await writeFile(
      path.join(tokensDir, 'drivers.json'),
      JSON.stringify(drivers),
    );
    await writeFile(
      path.join(tokensDir, 'dispatchers.json'),
      JSON.stringify(dispatchers),
    );
    await writeFile(
      path.join(tokensDir, 'meta.json'),
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          drivers: drivers.length,
          dispatchers: dispatchers.length,
          tokenTtl: '24h',
        },
        null,
        2,
      ),
    );

    console.log(`Wrote tokens → ${tokensDir}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
