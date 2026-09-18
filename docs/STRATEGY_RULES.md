# Strategy rules (Boriaz SMC)

Les règles SMC objectivées vivent dans `src/lib/smc.ts`, `smc-scan.ts`, `smc-live-gate.ts`, `btc-range.ts`.

## Checklist (100 %)

1. Sweep liquidité + CHoCH/BOS (clôture de corps) + FVG + ÔTE 0.618–0.786
2. Entrée LIMIT dans ÔTE∩FVG — jamais market chase
3. TP1 = 1R (**20%** lock, **80%** runner). Pas de BE immédiat ; lock +0.35R seulement si ≥1.5R. TP2 ≥ 2R
4. Correction : M15/M30 only (pas M5)
5. Range : **pas de SHORT en vrai bas**, **pas de LONG en haut D1**. W lower + D1 haut → short OK si SMC
6. **Pré-arm GTC** : EN ATTENTE continuation + IA → limite LIVE en ÔTE (pas de chase market)
7. Cron signaux **/5 min** (fenêtre OTE)
8. Sizing : risque **3–10 %** selon confiance
9. Objectif : **FAIRE GAGNER DE L'ARGENT** — refuse si espérance défavorable ; **pas de chase**

## Pipeline (AI_COST_CONTROL)

Jamais tick → LLM → trade.  
Toujours : SMC → score (≥75) → range → ChatGPT si budget → risk/live gates → lock → place.
