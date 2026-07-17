# Dispatcher API

Backend for the Dispatcher Expo app: auth, onboarding, **shared drives board**, applications, and **10% commission balances** (off-app pay, in-app settle + Sunday lock).

**Product brief:** [../docs/PRODUCT.md](../docs/PRODUCT.md) — agents should not invent marketplace/payment behavior that contradicts it.

Stack: Node 22 + Fastify + Drizzle. Hosted on Railway. Expo app is the only client.

Public URL (when deploy is healthy): `https://dispatcher-production-31d1.up.railway.app`

## Domain (short)

| Concept | Notes |
|---|---|
| Drive | Free-text route; passenger phone hidden until accept; optional address |
| Application | Includes applicant lat/lng; accept auto-rejects others |
| Complete | Cost required → 10% balance poster ← completing driver |
| Settle | Poster marks paid; unsettled past Sunday 11:59 → driver locked |
| Hide | Poster can hide completed trips they posted |

## Local

```bash
cp .env.example .env
# Point DATABASE_URL / REDIS_URL at Railway public URLs or local docker compose
npm install
npm run db:migrate
npm run dev
```

## Scripts

- `npm run dev` — watch mode
- `npm run build` / `npm start` — production
- `npm run db:generate` — make migrations from schema
- `npm run db:migrate` — apply migrations

## OpenAPI

See [openapi.json](./openapi.json).

## Railway

Project services: `api`, Postgres, Redis, `dispatcher-photos` bucket.

API env: `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `PORT`, `TZ`, optional `S3_*`.

Build: root [`Dockerfile`](../Dockerfile) copies `server/` (builder `DOCKERFILE`).

## Ops: slow-request alerts

Uses the same Telegram chats as 5xx alerts (`TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_IDS`). No APM agent — in-process only.

| Env | Default | Meaning |
|---|---|---|
| `SLOW_REQUEST_MS` | `1500` | Global latency threshold (ms). One number for now; per-route overrides can come later. |

Two signals (different titles / codes, same dedupe window):

1. **Individual slow request** — on each non-quiet response slower than `SLOW_REQUEST_MS`, texts `Slow request` (`code: slow_request`) with `ms` + `thresholdMs`. If that response is also a 5xx, you get one combined message (`HTTP 5xx + slow request`), not two.
2. **Sustained route p95** — every 60s, each instance snapshots its in-memory per-route ring (~200 samples, keyed by Fastify route pattern e.g. `GET /v1/drives/:id`). A Redis NX lock picks one replica to alert; any route whose p95 crossed `SLOW_REQUEST_MS` in that window texts `Slow route p95` with `n` / `p50` / `p95` / `p99`. Buffers reset every tick so this is “last minute,” not lifetime.

Quiet paths (`/healthz`, `/readyz`, …) are excluded from both. `slow_request` / `slow_route_p95` are not noise-filtered — they still go through the normal 60s fingerprint dedupe so a flapping endpoint does not flood.

## Horizontal scaling (connection budget)

Before adding a second Railway API replica, check the Postgres connection budget.

- Each production instance opens a postgres.js pool with **`max: 30`** (`src/db/client.ts`). Total app connections ≈ `30 × replica_count`, plus headroom for migrations, `drizzle-kit`, and any admin/CLI sessions.
- Confirm the Postgres plan’s `max_connections` comfortably fits that total. If not, lower the per-instance `max` before scaling out.

**Boot migrations:** `src/index.ts` runs `migrate()` on every process start. Concurrent deploys are assumed safe because drizzle-orm’s postgres-js migrator takes its own advisory lock — do not remove or special-case that call without verifying lock behavior.
