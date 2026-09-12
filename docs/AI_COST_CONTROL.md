# Contrôle des coûts IA

## Règle

Jamais : tick → LLM → trade.

Toujours : règles SMC/objectifs → score → SignalCandidate → IA **si** conditions → Risk Engine.

## Variables (défauts)

| Var | Défaut | Rôle |
|---|---|---|
| AI_ENABLED | true | Master |
| AI_MIN_SIGNAL_SCORE | 75 | Seuil d’appel |
| AI_TIMEOUT_MS | 2500 | Timeout |
| AI_COOLDOWN_SECONDS | 60 | Anti spam symbol/setup |
| MAX_AI_CALLS_PER_HOUR | 60 | Quota |
| MAX_AI_CALLS_PER_DAY | 500 | Quota |
| AI_DAILY_BUDGET_USD | 10 | Budget soft |
| AI_CIRCUIT_BREAKER_FAILURES | 5 | Ouvre le breaker |
| AI_REQUIRED_FOR_ENTRY | false | Si true, approve obligatoire |

Prompt système versionné : `prompts/trade_validation_system.txt`.

## Estimation appels

Avec cooldown 60s et watchlist ~12 coins : **plafond théorique ~60 appels/h** (quota), plutôt **5–20/h** si seuls les scores ≥75 passent.  
Coût = f(tokens × tarif provider) — ne pas inventer les tarifs ; mesurer via `ai_usage_metrics`.
