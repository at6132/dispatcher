# Dispatcher Admin

Standalone ops console for the Dispatcher API. Separate from the Expo driver app.

## Production

https://admin-production-6983.up.railway.app

Talks to `https://dispatcher-production-31d1.up.railway.app`. Login with password + Telegram `/allow`.

## Run locally

```bash
cd admin_app
npm install
npm run dev
```

Opens at http://localhost:5173

Set `VITE_API_URL` in `.env` to your API (local `http://localhost:8080` or Railway).

## Login (2 steps)

1. Enter the admin password (server `ADMIN_PASSWORD`).
2. Wait on the loading screen. Approved Telegram chats get a short code.
3. Reply `/allow` or `/allow CODE`.
4. The console unlocks once Telegram approves.

Deny with `/deny`. Kill sessions with `/logoutall`.
