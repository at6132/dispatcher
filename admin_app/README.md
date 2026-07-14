# Dispatcher Admin

Standalone ops console for the Dispatcher API. Separate from the Expo driver app.

## Run locally

```bash
cd admin_app
npm install
npm run dev
```

Opens at http://localhost:5173

Set `VITE_API_URL` in `.env` to your API (local `http://localhost:8080` or Railway).

## Login (2 steps)

1. Enter the admin password (server `ADMIN_PASSWORD`, currently set to `6132` in env).
2. Wait on the loading screen. Both approved Telegram chats get a message with a short code.
3. From an approved chat, send `/allow` or `/allow CODE`.
4. The console polls and enters once Telegram approves.

Deny with `/deny`. Kill every admin session with `/logoutall`.

## What you can manage

- Dashboard KPIs
- Users (edit, lock, revoke refresh tokens, set password)
- Drives (edit, cancel, see passenger phone)
- Applications
- Balances (settle / adjust with reason)
- Analytics funnel + events
- Security trace (requestId / IP / phone / user)
- Audit log
- Admin sessions

## CORS

Add the admin origin to the API `CORS_ORIGINS`, e.g.:

```
CORS_ORIGINS=http://localhost:5173
```
