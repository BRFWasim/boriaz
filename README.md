# BoriazBot

Dashboard **BoriazBot** : score **Alignement** (TF × crowd × Nansen × IA), vérif IA avant chaque trade, baleines Hyperliquid, tracking wallets, paper 1000 €, Telegram (`@BoriazBot`).

**URL :** [https://boriazbot-v4.vercel.app](https://boriazbot-v4.vercel.app) · [boriaz.com](https://boriaz.com)

## Déploiement

Repo GitHub : [BRFWasim/boriaz](https://github.com/BRFWasim/boriaz) → projet Vercel **boriazbot-v4**.

**Un push sur `main` redéploie tout seul.** Pas besoin de redeploy manuel à chaque fois.

Les clés restent sur Vercel (Environment Variables / Production). Pas de fichier `.env` secret dans le repo — seulement `.env.example` vide.

## Lancer en local

```bash
cp .env.example .env.local   # colle tes clés
npm install
npm run dev
```

Ouvrir [http://127.0.0.1:4317](http://127.0.0.1:4317).

## Fonctionnalités

- **Alignement** — TF × crowd × Nansen × IA
- **Portefeuille Boriaz (SMC)** — top-down D1→H4→H1→M15, checklist 6/6, risque exact 2 %, TP1 50 %+BE / TP2 2R, gate Claude Haiku
- **Gate IA** — 2ᵉ passage obligatoire avant paper / signal TG
- **Sureté max** — TG si 1h+4h alignés + crowd WR
- **Tracking wallets** — bouton Suivre + auto-follow qualité + alertes TG
- **Watchlist multi-TF** — BTC ETH SOL UNI AVAX LINK DOGE SUI RENDER ONDO HYPE TAO
- **Upstash KV** — paper + carnet + wallets suivis persistants
- **Cron ~1–5 min** — via **cron-job.org** (Hobby Vercel = 1×/jour natif max)

## Clés Vercel

[Variables boriazbot-v4](https://vercel.com/boriaz-bot/boriazbot-v4/settings/environment-variables) — détail dans `CLES-API.md`.

Cron :

```
https://boriazbot-v4.vercel.app/api/cron?secret=TON_CRON_SECRET
```

## Stack

Next.js, TypeScript, Tailwind, shadcn/ui. Pas un conseil financier.
