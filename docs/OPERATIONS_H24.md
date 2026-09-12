# Operations H24

## Local

```bash
cp .env.example .env.local
docker compose up -d postgres redis
# DATABASE_URL=postgresql://boriaz:boriaz@127.0.0.1:5432/boriazbot
# REDIS_URL=redis://127.0.0.1:6379
npm install
npm run db:migrate
npm run dev                 # Next.js dashboard :4317
npx tsx workers/market-data-worker.ts &
```

## Workers Docker

```bash
docker compose --profile workers up -d --build
```

## Modes

```bash
# Shadow (défaut)
TRADING_MODE=shadow LIVE_TRADING_ENABLED=false GLOBAL_KILL_SWITCH=true

# Paper
TRADING_MODE=paper GLOBAL_KILL_SWITCH=false

# Live (manuel uniquement)
TRADING_MODE=live LIVE_TRADING_ENABLED=true GLOBAL_KILL_SWITCH=false HL_LIVE_ENABLED=true
# + POST /api/bot/control { action:"mode", mode:"live", liveTradingEnabled:true, confirmLive:true }
# + POST /api/bot/control { action:"reconcile" }
```

## Health

- `GET /api/bot/health`
- `GET /api/bot/status` (auth site-gate)

## Important

Le cron Vercel/cron-job.org **reste** pour compat Hobby — ce n’est plus la cible H24. Les workers persistants sont la voie principale ; le cron peut être réduit ensuite.
