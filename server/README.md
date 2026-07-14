# Dispatcher API

Node 22 + Fastify + Drizzle. Hosted on Railway. Expo app is the only client.

Public URL (when deploy is healthy): `https://api-production-f4ac.up.railway.app`

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
