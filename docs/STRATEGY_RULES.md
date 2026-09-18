# Strategy rules (Boriaz SMC)

Les règles SMC objectivées vivent dans `src/lib/smc.ts`, `smc-scan.ts`, `smc-live-gate.ts`, `btc-range.ts`.

## Checklist (100 %)

1. Sweep liquidité + CHoCH/BOS (clôture de corps) + FVG + ÔTE 0.618–0.786
2. Entrée LIMIT dans ÔTE∩FVG — jamais market chase
3. TP1 = 1R (**20%** lock, **80%** runner). Lock +0.35R si ≥1.5R ; trail structurel post-TP1 (swing HL/LH)
4. Entrée : deep ÔTE 0.618–0.786 **ou** shallow retest BOS 0.5–0.618 (demi-taille) en continuation
5. H4-lead si D1 neutre (taille réduite) — early trend
6. Correction : M15/M30 only (pas M5)
7. Range : pas SHORT vrai bas, pas LONG D1 top
8. Pré-arm GTC + zone-watch */2 min + cancel GTC morts / trop loin + TP/SL orphelins sans position
9. Cron signaux */5 · sizing 3–10%
10. Objectif : **FAIRE GAGNER** — pas de chase ; cash = survie si pas d’edge

## Pipeline (AI_COST_CONTROL)

Jamais tick → LLM → trade.  
Toujours : SMC → score (≥75) → range → ChatGPT si budget → risk/live gates → lock → place.

## Roadmap (PG / strategy_versions)

Prochaine étape : extraire un FeatureEngine versionné (`strategy_versions.parameters_json`) avec poids de score configurables (défauts documentés dans l’audit / AI_COST_CONTROL).
