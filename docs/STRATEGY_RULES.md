# Strategy rules (Boriaz SMC)

Les règles SMC objectivées vivent dans `src/lib/smc.ts`, `smc-scan.ts`, `smc-live-gate.ts`, `btc-range.ts`.

## Checklist (100 %)

1. Sweep liquidité + CHoCH/BOS (clôture de corps) + FVG + ÔTE 0.618–0.786
2. Entrée LIMIT dans ÔTE∩FVG — jamais market chase
3. TP1 = 1R (**20%** lock, **80%** runner, SL structurel — **pas de BE**), TP2 ≥ 2R structurel
4. Correction : M15/M30 only (pas M5)
5. Range : **pas de SHORT en vrai bas** (W bottom / D1 bottom|lower), **pas de LONG en haut** (W upper|top / D1 top). Si W bas-médian mais D1/H4 hauts → ne plus geler les deux sens (short tactique possible, long toujours interdit au top).
6. Sizing : risque **3–10 %** selon confiance (setup sûr → viser ~100$+ / trade)
7. Objectif : **FAIRE GAGNER DE L'ARGENT** — refuse si espérance défavorable ; **pas de chase** (LIMIT en ÔTE seulement)

## Pipeline (AI_COST_CONTROL)

Jamais tick → LLM → trade.  
Toujours : SMC → score (≥75) → range → ChatGPT si budget → risk/live gates → lock → place.
