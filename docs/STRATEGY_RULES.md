# Strategy rules (Boriaz SMC)

Les règles SMC objectivées vivent dans `src/lib/smc.ts`, `smc-scan.ts`, `smc-live-gate.ts`, `btc-range.ts`.

## Checklist (100 %)

1. Sweep liquidité + CHoCH/BOS (clôture de corps) + FVG + ÔTE 0.618–0.786
2. Entrée LIMIT dans ÔTE∩FVG — jamais market chase / jamais limite marketable
3. TP1 = 1R (**20%** lock, **80%** runner). Lock +0.35R si ≥1.5R ; trail structurel post-TP1
4. Entrée : deep ÔTE **ou** shallow 0.5–0.618 (demi-taille)
5. H4-lead si D1 neutre (taille réduite)
6. Correction : M15/M30 only
7. Range : pas SHORT vrai bas, pas LONG D1 top
8. SL min alts **1.2%** ; cancel GTC morts + TP/SL orphelins
9. Sizing LIVE **prudent** : risque **2–4%**, levier ≤**5×**, **1** position max
10. Confiance LIVE ≥**82** (88 correction) ; cooldown **3h** après close (TP ou SL)
11. Objectif : **finir positif** — cash = survie ; pas de revenge re-entry

## Pipeline (AI_COST_CONTROL)

Jamais tick → LLM → trade.  
Toujours : SMC → score → range → ChatGPT si budget → risk/live gates → lock → place.
