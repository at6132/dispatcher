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
