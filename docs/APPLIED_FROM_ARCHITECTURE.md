# Appliqué depuis l’architecture (pg-redis / audit) — sans full PG rewrite

Propositions tirées de `docs/ARCHITECTURE.md`, `RISK_MANAGEMENT.md`, `AI_COST_CONTROL.md`, `ARCHITECTURE_AUDIT` et **appliquées** sur le monolithe Vercel actuel :

| # | Idée | Implémentation |
|---|---|---|
| 1 | Anti double-ordre | `kvSetNxEx` lock `boriaz:live-lock:{coin}:{side}` dans `placeBoriazLiveTrade` |
| 2 | Retry miroir sûr | Re-check HL + journal avant chaque retry `placeBoriazLiveTradeMirrored` |
| 3 | Réconciliation | `reconcileLiveVsJournal` → `reconciliation_required` bloque nouvelles entrées LIVE |
| 4 | Cooldown durable | Cooldowns LIVE en Upstash (`boriaz:live-cd:*`) — survit aux cold starts |
| 5 | Mutex manage TP1 | `boriaz:manage-smc-lock` autour de `manageLiveSmcPositions` |
| 6 | Budget IA | `canCallAi` score≥75 + quotas h/j + circuit breaker avant ChatGPT |
| 7 | Cron fail-closed | Sans `CRON_SECRET` → 503 (plus d’auth ouverte) |
| 8 | Qualité > quantité | Candidats continuation d’abord ; conf correction LIVE ≥82 |

**Non migré (volontairement)** : Postgres workers H24, mode shadow par défaut, Docker — trop invasif ; Upstash KV couvre locks/cooldowns/reconcile pour gagner de l’argent **maintenant**.
