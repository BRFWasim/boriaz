# BoriazBot / Hyperliquid — Architecture Audit

**Repo:** `/workspace` (`hyperliquid-whales` / BoriazBot)  
**Deploy:** Vercel project `boriazbot-v4` ([boriazbot-v4.vercel.app](https://boriazbot-v4.vercel.app))  
**Audit date:** 2026-09-08  
**Scope:** languages, structure, order execution, persistence, secrets, AI, cron, auth, risks, Postgres+Redis migration plan

---

## 1. Languages, frameworks, versions

| Layer | Tech | Declared | Lockfile (`package-lock.json` v3) |
|---|---|---|---|
| Runtime | TypeScript / Node (Next.js serverless) | `typescript` ^5 | **5.9.3** |
| App | Next.js App Router | **16.3.3** | 16.3.3 |
| UI | React / React DOM | **19.2.8** | 19.2.8 |
| Styling | Tailwind CSS v4 + tw-animate-css | ^4 / ^1.4.0 | via lock |
| Components | shadcn/ui + `@base-ui/react` | components.json + ^1.7.0 | — |
| Charts | `lightweight-charts` | ^5.2.1 | — |
| HL SDK | `@nktkas/hyperliquid` | ^0.33.3 | **0.33.3** |
| Wallet signing | `viem` | ^2.56.3 | **2.56.3** |
| Icons / utils | lucide-react, clsx, cva, date-fns | various | — |

**No Python.** No `requirements.txt` / `pyproject.toml`.  
**Package manager:** npm (`package-lock.json`).  
**Scripts** (`package.json`): `dev` / `start` on `127.0.0.1:4317`, `build`, `lint`.  
**Smoke script:** `scripts/smc-smoke.ts` (not wired in npm scripts).

---

## 2. Project structure

```
/workspace
├── package.json / package-lock.json / tsconfig.json / next.config.ts
├── vercel.json                 # native cron 1×/day → /api/cron
├── .env.example                # env name docs (no secrets)
├── README.md / CLES-API.md
├── public/                     # PWA manifest, sw.js, icons
├── scripts/smc-smoke.ts
├── artifacts/                  # demo screenshots (not runtime)
└── src/
    ├── middleware.ts           # soft site-gate for private APIs
    ├── app/
    │   ├── page.tsx            # single SPA shell → WhalesDashboard
    │   ├── layout.tsx, loading.tsx, not-found.tsx
    │   ├── login/page.tsx
    │   └── api/**/route.ts     # 25 API routes
    ├── components/             # panels + shadcn ui/
    └── lib/                    # trading brain, HL, persist, AI (~50 modules)
```

Monolith Next.js app: UI + bot + exchange client in one Vercel deployment. No separate worker service.

---

## 3. Backend — Next.js API routes

Glob: `src/app/api/**/route.ts` (25 files).

### Trading-critical (execution, manage, live state, cron)

| Route | Role |
|---|---|
| `src/app/api/cron/route.ts` | Heartbeat ACK + `after()` → `runCronWork` (manage → signals → BTC → macro → wallets) |
| `src/app/api/cron/manage/route.ts` | Manage-only ACK + `after()` |
| `src/app/api/signals/route.ts` | `getTradeSignals` — paper open + LIVE place |
| `src/app/api/live-close/route.ts` | Manual HL flatten (`closeLivePosition`) |
| `src/app/api/live-mirror/route.ts` | Manual paper Boriaz/SMC → LIVE mirror |
| `src/app/api/live-account/route.ts` | Real HL portfolio + journal enrichment |
| `src/app/api/live-status/route.ts` | Live env readiness / toggle status |
| `src/app/api/manage/route.ts` | Paper manage + live advisory reviews |
| `src/app/api/paper/route.ts` | Paper CRUD / browser merge |
| `src/app/api/prefs/route.ts` | User prefs + portfolio LIVE/paper toggles |
| `src/app/api/smc/route.ts` | SMC scan (gate before Boriaz paper/live) |
| `src/app/api/journal/route.ts` | Trade journal read |

### Dashboard / intel / auth (non-execution)

| Route | Role |
|---|---|
| `src/app/api/whales/route.ts` | Whale dashboard + alerts |
| `src/app/api/home/route.ts` | Home snapshot |
| `src/app/api/live/route.ts` | Light mids + paper MTM (name is misleading — not order placement) |
| `src/app/api/candles/route.ts` | Candle proxy for charts |
| `src/app/api/btc-analysis/route.ts` | BTC multi-TF analysis (+ optional AI) |
| `src/app/api/macro/route.ts` | Macro calendar / alerts data |
| `src/app/api/correlation/route.ts` | Macro correlation |
| `src/app/api/backtest/route.ts` | Simple backtest |
| `src/app/api/status/route.ts` | Integration key presence (booleans only) |
| `src/app/api/account/route.ts` | Soft sim-user session (name/PIN) |
| `src/app/api/site-auth/route.ts` | Site password cookie |
| `src/app/api/wallets/route.ts` | Followed wallets |
| `src/app/api/telegram/setup/route.ts` | Link Telegram chat |

---

## 4. Frontend panels / pages (trading & analysis)

Single page app: `src/app/page.tsx` → `WhalesDashboard`.

| Tab / component | File | Shows |
|---|---|---|
| Accueil | `src/components/home-panel.tsx` | Paper portfolios, signals summary, live wallet links |
| Baleines | `whales-dashboard.tsx` + `whale-card.tsx` + `market-overview.tsx` | Leaderboard / crowd |
| Spot | `spot-alerts-panel.tsx` | Spot-oriented alerts |
| Analyse | `btc-analysis-panel.tsx` + `price-chart.tsx` | BTC/SOL TF analysis, AI commentary |
| Macro | `macro-panel.tsx` | Macro events |
| **Boriaz** (gated) | `boriaz-panel.tsx` | SMC setups, LIVE wallet, close buttons |
| **Lab** (gated) | `lab-panel.tsx` | Prefs, paper/LIVE toggles, portfolios, journal, status |
| Shared | `live-close-buttons.tsx`, `trade-live-review.tsx` | Manual close + live manage snapshots |
| Login | `src/app/login/page.tsx` | Site password |

Boriaz/Lab require `SITE_PASSWORD` + cookie (`middleware.ts`).

---

## 5. Persistence today

### Abstraction

| Module | Role |
|---|---|
| `src/lib/kv.ts` | Upstash Redis REST (`GET`/`SET`/`SET EX`) or in-process `Map` |
| `src/lib/data-dir.ts` | Writable dir = `/tmp/boriazbot-data` (serverless-safe) |
| `src/lib/persist.ts` | Prefs, paper, journal, book, wallets, macro keys |
| `src/lib/live-journal.ts` | Shared LIVE order journal |
| `src/lib/paper-local.ts` | Browser `localStorage` backup `boriazbot-paper-v1` |
| `src/lib/accounts.ts` | Soft users store |
| `src/lib/cron-status.ts` | Last cron tick |
| `src/lib/manage-live-positions.ts` | Live manage snapshot orphans |
| `src/lib/price-watch.ts` | Spike/digest state file (FS only) |

**Backend selection:** if `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` → Upstash; else memory + `/tmp` (ephemeral on Vercel cold start).

### KV keys (Upstash / logical)

| Key | Content |
|---|---|
| `boriazbot:{userId}:prefs` | UserPrefs + portfolios |
| `boriazbot:{userId}:paper` | PaperTrade[] |
| `boriazbot:{userId}:journal` | JournalEntry[] |
| `boriazbot:prefs` / `:paper` / `:journal` | Legacy unscoped |
| `boriazbot:global:book` | Shared book trades |
| `boriazbot:global:followed-wallets` | Followed wallets |
| `boriazbot:global:wallet-snap` | Wallet position snapshots |
| `boriazbot:macro-alerts` | Macro alert de-dupe keys |
| `boriazbot:hl-live-journal` | **Shared** LIVE journal (all bots / one HL wallet) |
| `boriazbot:default:live-journal` / `boriazbot:{user}:live-journal` | Legacy live journals (migrated on read) |
| `boriazbot:hl-live-manage-snaps` | Live manage snapshots for orphan positions |
| `boriazbot:users` | Soft account registry |
| `boriaz:trade-signals-v1` | Cached `TradeSignalPayload` (TTL ~15–20s) |
| `boriaz:last-cron-v1` | Last cron status |

### Filesystem (`/tmp/boriazbot-data/`)

- Mirror of KV keys as `.{sanitized-key}.json`
- `.hl-live-manage-snaps.json`
- `.users.json`
- `.price-watch-state.json` (price samples / spike cooldowns — **not** in Upstash)
- `.telegram-chat-id` (discovered chat id)

### Client

- `localStorage` paper: `boriazbot-paper-v1` (`paper-local.ts`)
- Lab prefs cache key in `lab-panel.tsx` / `home-panel.tsx`
- Theme key in `whales-dashboard.tsx`

---

## 6. Hyperliquid integration

### HTTP only — no WebSocket

| Path | Transport | Purpose |
|---|---|---|
| `src/lib/hyperliquid.ts` | `fetch` → `https://api.hyperliquid.xyz/info` (+ leaderboard stats URL) | Public info: clearinghouse, orders, fills, candles, mids, meta |
| `src/lib/hl-live.ts` | `@nktkas/hyperliquid` `HttpTransport` + `InfoClient` + `ExchangeClient` | Signed exchange: leverage, place, cancel, close |

No `WebSocket` / `SubscriptionClient` usage for HL.

### Order placement call graph

```
Cron /api/cron (after) or GET /api/signals?force=1
  └─ runCronWork / getTradeSignals
       ├─ refreshPaperTrades (TP/SL paper)
       ├─ manageLiveSmcPositions()          # TP1→BE+TP2 on live SMC
       ├─ alignment portfolios → openPaperTrade → placeBoriazLiveTrade[Mirrored]
       └─ SMC portfolios → scanSmcWatchlist → openPaperTrade
            └─ if pf.id==="boriaz": placeBoriazLiveTradeMirrored (toggles ignored; env kill-switch only)

POST /api/live-mirror  → placeBoriazLiveTradeMirrored (manual)
POST /api/live-close   → closeLivePosition
Cron manage            → manageLiveSmcPositions + manageLivePositionReviews (advisory; no auto-close HL)
```

### `placeBoriazLiveTrade` (`hl-live.ts`) internals

1. Kill-switches: `HL_LIVE_ENABLED`, agent key, master `HL_ACCOUNT_ADDRESS`
2. Caps: `HL_MAX_NOTIONAL_USD`, `HL_MAX_LEVERAGE`, `HL_MAX_OPEN_POSITIONS`
3. Size from real HL equity (`sizeLiveFromRealEquity`) — optional paper-margin mirror
4. `updateLeverage` (cross)
5. Orders via `client.order`:
   - **SMC split:** entry full → then TP1 50% + TP2 50% + SL 100% (`grouping: "na"`)
   - **Else:** entry + TP + SL (`grouping: "normalTpsl"`)
6. `recordLiveJournalEntry` → `boriazbot:hl-live-journal`

`placeBoriazLiveTradeMirrored`: up to **3 retries** on soft skip (429/timeout/equity lag).

---

## 7. Secrets / env names (values never logged here)

| Env | Used for |
|---|---|
| `HL_LIVE_ENABLED` | Live kill-switch |
| `HL_AGENT_PRIVATE_KEY` (alias `HL_PRIVATE_KEY`) | Agent wallet signing — **server only** |
| `HL_ACCOUNT_ADDRESS` | Master address (USDC holder) |
| `HL_LIVE_TESTNET` | Testnet transport |
| `HL_MAX_NOTIONAL_USD` / `HL_MAX_LEVERAGE` / `HL_MAX_OPEN_POSITIONS` | Safety caps |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Persistent KV |
| `CRON_SECRET` | Cron auth (+ site-gate material fallback) |
| `SITE_PASSWORD` / `SITE_GATE_SECRET` | UI portal |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | GPT gate + commentary |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | Claude (BTC dual AI, manage; SMC gate currently disabled) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Alerts |
| `NANSEN_API_KEY` / `ARKHAM_API_KEY` / `COINGECKO_API_KEY` | Intel / macro |
| `VERCEL` / `AWS_LAMBDA_FUNCTION_NAME` / `NODE_ENV` | Serverless FS detection |

Private key read site: `readAgentPrivateKey()` in `src/lib/hl-live.ts` only. Never returned by APIs (`live-account` documents this).

---

## 8. AI / LLM calls

| Module | Provider(s) | Model defaults | When |
|---|---|---|---|
| `trade-signal.ts` → `verifyTradeWithAi` / gate helpers | **OpenAI** (Claude path commented out) | `OPENAI_MODEL` or `gpt-4o-mini` | Before opening alignment paper when `requireAiGate` |
| `smc-scan.ts` → `askGptSmcGate` | **OpenAI** (Claude stub returns null) | same | Before SMC paper/live; mechanical checklist if no key |
| `manage-trades.ts` | Anthropic then OpenAI | Haiku / gpt-4o-mini | Paper trade management advice / actions |
| `manage-live-positions.ts` | via `evaluateTradeManage` | same | Live **advisory** snapshots (does not auto-close HL) |
| `ai-analysis.ts` → `dualAiBtcCommentary` | OpenAI **+** Anthropic | both | BTC analysis when `includeAi` |
| `btc-analysis.ts` | via `ai-analysis` | — | Cron (`includeAi: true`) and `/api/btc-analysis?ai=1` |

Caches: AI commentary ~45 min (`ai-analysis.ts`); SMC scan ~30s; trade-signals shared KV ~15–20s.

---

## 9. Cron / scheduled jobs

| Mechanism | Detail |
|---|---|
| `vercel.json` | `"0 8 * * *"` → `/api/cron` (Hobby = 1/day native max) |
| External | cron-job.org every 1–5 min: `/api/cron?secret=…` (+ optional `/api/cron/manage`) |
| ACK pattern | `after()` from `next/server`; HTTP returns in &lt;2s; work continues up to `maxDuration` 90–120s |
| Worker | `src/lib/cron-runner.ts` → `runCronWork(phase)` |
| Phases | `all` \| `manage` \| `signals` |
| Auth | `CRON_SECRET` Bearer or `?secret=`; **if unset, cron is open** |
| Middleware | `/api/cron*` exempt from site-gate |

Order inside `all`: manage paper → live SMC manage → live reviews → price watch → **getTradeSignals(force)** → BTC analysis → macro T-30 → wallet track.

---

## 10. Auth

| Layer | Files | Behavior |
|---|---|---|
| Site gate | `site-gate.ts`, `middleware.ts`, `/api/site-auth` | Cookie `bb_site_gate` = SHA-256 of gate material + password; protects private APIs listed in middleware |
| Soft sim users | `accounts.ts`, `/api/account`, `session.ts` | Name/PIN users; scopes persist keys via `setPersistUser` |
| Cron | exempt | Bot runs without UI login |
| Without `SITE_PASSWORD` | private APIs return **503** (Boriaz/Lab locked) | Public tabs still open |

`LIVE_ALLOWED_PORTFOLIO_IDS` in `site-gate.ts` = `{default, boriaz}` — docs/UI helper. Actual live allowlist is `portfolioAllowsLive()` in `user-types.ts` (**also Scalp** by name/id).

---

## 11. Docker / CI / deploy

| Artifact | Present? |
|---|---|
| Dockerfile / compose | **No** |
| `.github/workflows` | **No** |
| Deploy | GitHub → Vercel auto on `main` |
| Config | `vercel.json`, `next.config.ts` (`agentRules: false`) |
| Docs | `README.md`, `CLES-API.md`, `.env.example` |

---

## 12. Trading modes (paper vs live)

| Control | Where | Effect |
|---|---|---|
| Global `paperTradeEnabled` | prefs / Lab | Master paper on/off |
| Global `liveTradeEnabled` | prefs / Lab | Master live for alignment portfolios |
| Per-portfolio `paperTradeEnabled` / `liveTradeEnabled` | portfolios | Per-bot toggles |
| Env `HL_LIVE_ENABLED` | Vercel | Hard kill-switch |
| Portfolio rules | `portfolioAllowsLive` | LIVE only for **default**, **boriaz**, **scalp**; never **risqué** |
| Boriaz SMC live | `trade-signal.ts` | If paper Boriaz opens → live mirror **even if Lab toggles off** (env kill-switch still applies) |
| Alignment live | same | Needs `prefs.liveTradeEnabled && pf.liveTradeEnabled` (boriaz alignment path also special-cased) |
| Strategies | `alignment` vs `smc` | Split in `getTradeSignals`; Boriaz forced `smc` |

Defaults: DEFAULT paper on / live off; BORIAZ paper on / live on (still needs env + capital).

---

## 13. Double-order risks (concrete)

1. **Mirror retry after silent success** — `placeBoriazLiveTradeMirrored` retries 3× on `skipped: true` (timeouts/429). If HL accepted the entry but the client timed out, retry can place a **second** entry. No client-order-id / idempotency key.

2. **No per-coin open-position guard in placer** — only total `openN >= maxOpenPositions` (soft-raised to 8 when `mirrorPaper`). Existing same-coin position does not block another order.

3. **Concurrent triggers** — cron `force: true`, Lab “scan now”, `/api/signals?force=1`, and `/api/live-mirror` can race. Paper de-dupe (`openPaperTrade` same coin+side → null) helps paper; live path can still fire if paper already exists from another scope or mirror bypasses paper open.

4. **SMC manage path** — `manageLiveSmcPositions` cancels opens and may market-close 50% then re-place TP/SL; concurrent manage cron + signals manage can race cancels/orders.

5. **Shared signal cache vs force** — UI idle uses cache; cron always forces — good for freshness, bad for de-dupe across overlapping invocations within the same second.

6. **Cron without `CRON_SECRET`** — unauthorized callers can trigger live placement.

Mitigations that exist today: paper same-coin+side null; live journal one-open-per-coin+side (journal only, not HL); live-mirror refuses if note already contains `LIVE HL`; open-position count soft cap.

---

## 14. Client-side secret risks

| Risk | Assessment |
|---|---|
| Private key in browser | **Not present** — no `NEXT_PUBLIC_` HL key; signing only in `hl-live.ts` server |
| Lab UI | Mentions env **names** only; does not accept pasting agent key into forms |
| `/api/status` | Returns **booleans** for key presence, not values |
| `localStorage` paper / prefs | Trading state backup only — not secrets |
| Soft account PIN | Stored server-side in users KV — weak auth, not HL custody |
| Site gate | Password compared server-side; cookie is hash token |
| Residual | Compromised `SITE_PASSWORD` + live env → attacker can call private APIs (`live-close`, `live-mirror`, prefs). Cron secret in URL query may appear in logs/referrers |

---

## 15. What MUST be preserved

1. **Kill-switch stack:** `HL_LIVE_ENABLED` + agent key + master address ≠ agent + Lab/portfolio toggles (with documented Boriaz SMC auto-mirror exception).
2. **Paper-first flow** for alignment; SMC checklist 6/6 + AI/mechanical gate before size.
3. **Sizing model:** ~2% risk / paper-margin fraction mirrored onto **real HL equity**, with `HL_MAX_*` caps.
4. **LIVE journal** shared key — bot labels / TP-SL attribution (HL does not tag bots).
5. **SMC TP1 50% + BE + TP2** parity paper ↔ live (`manageLiveSmcPositions`).
6. **Cron ACK + `after()`** compatible with cron-job.org 30s timeout + Hobby Vercel limits.
7. **Site-gate vs cron exemption** — UI lock must not stop the bot.
8. **Upstash-or-tmp dual write** behavior until Postgres cutover (no silent data loss on cold start without a durable store).
9. **Public HL info path** (`hyperliquid.ts`) independent of exchange signing.
10. **Telegram notify semantics** (hush hours, closeNotified, max-safety mode).
11. **Watchlist / portfolio model** (default + boriaz always present; scalp/risqué rules).
12. **No private keys in responses or git.**

---

## 16. Incremental Postgres + Redis migration (keep Vercel serverless path)

Goal: add durable SQL + Redis **without** breaking current Upstash REST + `/tmp` fallback on Vercel.

### Design principle

Introduce a storage facade behind existing `kvGet`/`kvSet` and `persist.ts` readers/writers. Feature-flag backends:

`STORAGE_BACKEND=upstash|redis|postgres+redis|tmp`

Default remains today’s Upstash REST so production keeps working.

### Files to **create**

| File | Purpose |
|---|---|
| `src/lib/db/postgres.ts` | Neon/Postgres pool via `@neondatabase/serverless` or `pg` (lazy connect; no import at edge middleware) |
| `src/lib/db/schema.sql` | Tables: `prefs`, `paper_trades`, `journal_entries`, `live_journal`, `book_trades`, `followed_wallets`, `wallet_snaps`, `users`, `cron_status`, `kv_blob` (escape hatch) |
| `src/lib/db/migrate.ts` | Idempotent migrate runner (or `drizzle`/`kysely` migrations folder) |
| `src/lib/store/types.ts` | `KvStore` / `DocumentStore` interfaces matching current JSON blobs |
| `src/lib/store/upstash-rest.ts` | Move current Upstash REST impl out of `kv.ts` |
| `src/lib/store/redis-ioredis.ts` or `upstash-redis-sdk.ts` | Optional native Redis (still serverless-friendly: Upstash SDK or REST) |
| `src/lib/store/postgres-documents.ts` | JSONB document API mirroring key→JSON used today |
| `src/lib/store/hybrid.ts` | Read-through: Redis cache → Postgres source of truth; write-through both |
| `src/lib/store/index.ts` | Factory selected by env |
| `scripts/migrate-upstash-to-pg.ts` | One-shot: dump Upstash keys → Postgres rows |
| `ARCHITECTURE_AUDIT.md` | This document |

### Files to **modify** (thin adapters; keep call sites stable)

| File | Change |
|---|---|
| `src/lib/kv.ts` | Delegate to `store/index.ts`; preserve `kvGet`/`kvSet`/`kvSetEx` signatures |
| `src/lib/persist.ts` | Optionally map paper/prefs/journal to normalized tables **behind** same exported functions (`loadPaperTrades`, `savePrefs`, …) |
| `src/lib/live-journal.ts` | Same API; backend via store (critical for live de-dupe later) |
| `src/lib/accounts.ts` | Users table or continue JSON blob in `kv_blob` |
| `src/lib/cron-status.ts` | Postgres row or Redis key |
| `src/lib/manage-live-positions.ts` | Snaps via store |
| `src/lib/trade-signal.ts` | Keep cache key `boriaz:trade-signals-v1` on Redis TTL |
| `src/lib/price-watch.ts` | Move state from FS-only into Redis/Postgres (today lost on cold start) |
| `src/lib/data-dir.ts` | Keep as last-resort FS cache; document “dev/tmp only” |
| `.env.example` | Add `DATABASE_URL`, `STORAGE_BACKEND`, optional `REDIS_URL` |
| `CLES-API.md` / `README.md` | Dual-run instructions |
| `package.json` | Add DB client dep; optional `migrate` script |
| `vercel.json` | Unchanged cron paths |

### Suggested phased cutover (no big-bang)

1. **Phase A — facade only:** refactor `kv.ts` → store adapters; production still Upstash REST. Zero behavior change.
2. **Phase B — Redis dual-write:** when `REDIS_URL` / Upstash SDK set, write Redis + keep REST; read Redis with REST fallback.
3. **Phase C — Postgres shadow writes:** write JSONB copies of prefs/paper/live-journal; reads still Upstash. Validate row counts vs keys.
4. **Phase D — Postgres primary reads** for paper/prefs/live-journal; Redis for TTL caches (`trade-signals`, AI later).
5. **Phase E — normalize paper/live_journal tables** (indexed `status,coin,side`) to enable **idempotent live placement locks** (fixes §13).
6. Keep `/tmp` + memory fallback for local/dev and emergency.

### Must not break on Vercel

- Middleware stays Edge-safe (no `pg` import in `middleware.ts` / `site-gate.ts`).
- Exchange signing stays in Node `runtime = "nodejs"` routes / `hl-live.ts`.
- `after()` cron ACK pattern unchanged.
- Env kill-switches unchanged.
- Existing Upstash env vars remain valid until Phase D.

### Highest-value first tables

1. `live_journal` — safety / attribution  
2. `paper_trades` + `prefs` — user-visible money simulation  
3. `cron_status` + signal cache — ops  
4. Everything else can stay opaque JSONB longer

---

## Appendix A — Order execution file map

| Concern | Primary files |
|---|---|
| Signal → paper → live | `trade-signal.ts`, `persist.ts`, `hl-live.ts` |
| SMC setup + gate | `smc.ts`, `smc-scan.ts`, `smc-open-review.ts` |
| Live manage TP1 | `hl-live.ts` (`manageLiveSmcPositions`) |
| Live advisory | `manage-live-positions.ts`, `manage-trades.ts` |
| Manual live | `api/live-mirror`, `api/live-close`, `live-close-buttons.tsx` |
| Public market data | `hyperliquid.ts`, `price-watch.ts`, `market-analysis.ts` |
| Cron orchestration | `cron-runner.ts`, `api/cron/*` |

## Appendix B — Gaps / inconsistencies to track

- `site-gate.LIVE_ALLOWED_PORTFOLIO_IDS` excludes Scalp; `portfolioAllowsLive` includes Scalp.
- `/api/live` is mark-to-market, not execution (naming trap).
- Price-watch state not in Upstash (lost on cold start).
- Missing `CRON_SECRET` ⇒ open cron endpoint.
- No Docker/CI; reliance on Vercel + external cron.
- SMC comments still say “Claude Haiku” in places; runtime gate is ChatGPT / mechanical.
