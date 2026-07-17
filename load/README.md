# Dispatcher launch load test

2000 drivers (Home board + offer poll + presence + apply) and 500 dispatchers (create + accept), against prod.

Prod wipe tomorrow is assumed — this seeds bot users and creates real rides.

## Why the API change

All bots share one egress IP. Without a bypass, the global **400 req/min/IP** limiter and per-route IP buckets would fake-fail the test. Real drivers do not share one IP.

Deploy with:

```env
LOAD_TEST_BYPASS_SECRET=<32+ char secret>
```

k6 sends `X-Load-Test: <secret>`. That skips **IP** rate limits only — **per-user** limits still apply.

Remove the env var after the test window.

## Prereqs

1. [k6](https://k6.io/docs/get-started/installation/) — `winget install k6`
2. `server/.env` with `DATABASE_URL`, `JWT_ACCESS_SECRET`, and the same `LOAD_TEST_BYPASS_SECRET` as Railway
3. Redeploy API so the bypass is live

## Run

### Smoke (5 min, 50 + 10)

```powershell
cd load
.\run.ps1 -Mode smoke
```

### Full launch rehearsal (~32 min)

```powershell
cd load
.\run.ps1 -Mode launch
```

Manual:

```powershell
cd server
npx tsx scripts/seed-load-users.ts

cd ..\load\k6
$env:BASE_URL = "https://dispatcher-production-31d1.up.railway.app"
$env:LOAD_TEST_BYPASS_SECRET = "<same as Railway>"
$env:K6_WEB_DASHBOARD = "true"
$env:K6_WEB_DASHBOARD_PORT = "5665"
k6 run launch.js
```

## Watch

| Surface | URL |
|---|---|
| Local monitor | `load/dashboard/index.html` (auto-opened by `run.ps1`) |
| k6 live charts | http://127.0.0.1:5665 |
| API ready | https://dispatcher-production-31d1.up.railway.app/readyz |
| Railway metrics | Railway project → API + Postgres + Redis |

### Pass bar

| Metric | Target |
|---|---|
| p95 overall | &lt; 1500 ms |
| p95 `board_open` / `board_offers` | &lt; 1500 / 1200 ms |
| Error rate | &lt; 2% (409/429 from races count as OK in checks) |
| `/readyz` | stays 200 |
| Postgres connections | under plan max (30 × API replicas + headroom) |

## Traffic shape

| Role | VUs | Behavior |
|---|---|---|
| Drivers | 2000 | Offers every 8s, open board ~24s, presence ~48s, ~15% of board refreshes apply |
| Dispatchers | 500 | Create ride ~every 2.5–4 min (under 30/user/hr), wait, accept first applicant |

Peak steady reads ≈ **~250+ RPS** from offer polling alone.

## Afterward

1. Unset `LOAD_TEST_BYPASS_SECRET` on Railway and redeploy
2. Wipe / reset prod as planned
3. Keep `load/reports/` if you want the HTML export
