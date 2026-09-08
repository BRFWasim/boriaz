# Architecture cible (incrémentale)

```
Hyperliquid (HTTP aujourd’hui / WS demain)
        ↓
market-data-worker (persistants, heartbeat Redis)
        ↓
Redis (cache + locks + heartbeats)     PostgreSQL (source de vérité)
        ↓                                         ↑
strategy-worker → signal_candidates ──────────────┘
        ↓
ai-validation-worker (conditionnel, budget)
        ↓
risk-execution-worker (seul autorisé à trader live)
        ↓
Hyperliquid Exchange API
        ↓
Dashboard Next.js (observation / control authentifié)
```

## Hypothèse stack

Le monolithe existant est **Next.js/TypeScript sur Vercel**.  
Les workers H24 sont donc en **Node/tsx** (réutilisent `src/lib/*`), pas Python — pour éviter une double stack ORM/trading. Python pourra arriver plus tard si besoin, derrière les mêmes tables PG.

## Modes

| Mode | Ordres HL | Persistance |
|---|---|---|
| shadow | jamais | décisions loggées |
| paper | jamais | simulation existante + intents |
| live | seulement si toutes les gates OK | intents + orders + fills |

Défaut post-migration : **shadow** + kill switch **ON**.
