# Dispatcher

Expo (SDK 54) + Fastify API for a **shared drive board** used by ~500–600 drivers (WhatsApp replacement). Post free-text routes, apply, accept, unlock passenger contact, complete jobs, and track **10% off-app commission balances** with Sunday lock.

**Product intent for agents and humans:** [docs/PRODUCT.md](./docs/PRODUCT.md)  
**Design:** [AGENTS.md](./AGENTS.md) · [`.cursor/rules/design-profile.mdc`](./.cursor/rules/design-profile.mdc)

## What’s in this repo

| Path | Role |
|---|---|
| `/` | Expo Go client (React Native / TypeScript) |
| `server/` | API — auth, onboarding, drives, balances (Railway + Postgres + Redis) |

Auth + onboarding hit the API today. Home / Bank / create-drive still lean on demo or stubs in places — wire to the drives board per the product brief.

## Client

```bash
npm install
npm start
```

Scan the QR with [Expo Go](https://expo.dev/go). Point the app at your API via `.env` (see repo env examples).

## API

See [server/README.md](./server/README.md). Public OpenAPI: [server/openapi.json](./server/openapi.json).

## For coding agents

1. Read [docs/PRODUCT.md](./docs/PRODUCT.md) before inventing product behavior
2. Follow the design profile in `AGENTS.md` (mid dusk liquid glass)
3. Bad cell service is a **main** goal — offline/cache/queue is part of “done”
