# Dispatcher API

Node 22 + Fastify + Drizzle. Hosted on Railway. Expo app is the only client.

## Local

```bash
cp .env.example .env
docker compose up -d
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
