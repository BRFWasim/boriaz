# BoriazBot

Dashboard **BoriazBot** : signaux LONG/SHORT (entrée / TP / SL), baleines Hyperliquid, zones d’achat cohérentes, macro US, paper trade, journal et alertes Telegram (`@BoriazBot`).

Ce n’est **pas un conseil financier**. Les positions et les prix bougent vite. Les SL/TP affichés sur les baleines ne le sont que s’ils existent en carnet.

## Lancer en local

```bash
npm install
npm run dev
```

Ouvrir [http://127.0.0.1:4317](http://127.0.0.1:4317).

```bash
npm run build && npm start
```

## Fonctionnalités

- **Accueil** — watchlist live, biais LONG/SHORT, entrée idéale / TP / SL, fermeture suggérée
- **Baleines** — scan élargi (~18 wallets HL actifs), badge fiabilité WR (échantillon, PF, expectancy), labels Nansen
- **Spot & alertes** — crowd long/short qualité, prix live
- **Analyse marché** — BTC multi-TF, SOL, zones d’achat (corrigées vs tendance/prix)
- **Macro** — calendrier High impact + alertes Telegram **T−30 min**
- **Lab** — journal des signaux, paper trade, corrélation DXY/US10Y vs BTC, backtest RSI 30–90 j, préférences (levier max, cryptos, hush hours TG)

## Telegram 24/7 (Vercel Cron)

`vercel.json` appelle `/api/cron` toutes les **15 minutes** (prix, signaux + TG, macro T−30).

Définis `CRON_SECRET` et (sur Vercel Pro/Hobby selon plan) les crons sont actifs après déploiement. En local :

```bash
curl "http://127.0.0.1:4317/api/cron?secret=TON_SECRET"
```

## Publier

Next.js → Vercel (bouton **Publish** dans Cursor, ou import Git). Ajoute les variables de `.env.example` dans le projet Vercel.

## Stack

Next.js (App Router), TypeScript, Tailwind, shadcn/ui. Données Hyperliquid publiques ; Nansen / OpenAI / Anthropic / Telegram optionnels.
