# Checklist migration BoriazBot (post-audit)

## Fait dans ce lot (Phase 1–4 partielle)

- [x] `ARCHITECTURE_AUDIT.md`
- [x] Migrations PostgreSQL `001_trading_core` (up/down) — tables trading + audit + runtime config
- [x] Client PG + runner `npm run db:migrate`
- [x] Redis client (ioredis / Upstash REST / memory) + locks + heartbeats
- [x] Modes `shadow|paper|live` + `LIVE_TRADING_ENABLED` + `GLOBAL_KILL_SWITCH` (défaut shadow / kill ON)
- [x] Gate sur `placeBoriazLiveTrade` — **aucun ordre live par défaut**
- [x] Réconciliation HL ↔ journal (`reconcileLiveState`)
- [x] APIs `/api/bot/status`, `/api/bot/health`, `/api/bot/control`
- [x] Docker Compose postgres+redis (+ workers profil)
- [x] Workers scaffolds H24 (market/strategy/risk/scheduler)
- [x] Docs ops / risk / AI cost / architecture
- [x] Prompt IA versionné
- [x] Tests unitaires money + trading-mode env

## Prochaines étapes (ne pas activer live)

1. Brancher WebSocket HL dans `market-data-worker` (SubscriptionClient)
2. FeatureEngine déterministe + unit tests SMC
3. StrategyEngine → `signal_candidates` + Redis Streams
4. AIValidationService conditionnel (Haiku/GPT) + budget
5. RiskEngine complet → `trade_intents` + idempotency
6. Dual-write Upstash → PG pour paper/prefs/live_journal
7. Dashboard onglet Bot Status
8. Backtest/replay partagé

## Rollback

- `npm run db:migrate:down` (drop tables 001)
- Retirer `assertLiveEntryAllowed` gate si besoin d’urgence (revenir à HL_LIVE_ENABLED seul)
- `docker compose down` (volumes conservés sauf `-v`)

## Avant LIVE (manuel)

1. `TRADING_MODE=shadow` validé
2. PG migrations OK + Redis durable OK
3. `POST /api/bot/control` reconcile OK
4. Paper mode validé
5. `confirmLive=true` + `LIVE_TRADING_ENABLED=true` + `GLOBAL_KILL_SWITCH=false` + `HL_LIVE_ENABLED=true`
6. `ALLOW_TESTNET_LIVE` seulement si testnet intentionnel
