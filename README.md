# BoriazBot

Dashboard **BoriazBot** : score **Alignement** (TF × crowd × Nansen × IA), signaux LONG/SHORT, baleines Hyperliquid, paper trade, journal et Telegram (`@BoriazBot`).

**URL unique (ne change plus) :** [https://boriazbot-v4.vercel.app](https://boriazbot-v4.vercel.app)

Ce n’est **pas un conseil financier**.

## Lancer en local

```bash
npm install
npm run dev
```

Ouvrir [http://127.0.0.1:4317](http://127.0.0.1:4317).

## Fonctionnalités

- **Alignement** — score unique avant tout trade (TF × crowd × Nansen × IA)
- **Sureté max** — Telegram seulement si 1h+4h alignés **et** crowd WR
- **Divergences** — alerte si analyse 1h LONG mais signal WAIT
- **Watchlist multi-TF** — BTC, ETH, SOL, UNI, AVAX, LINK, DOGE, SUI, RENDER, ONDO, HYPE, TAO
- **Upstash KV** — paper + journal persistants (sinon `/tmp` éphémère)
- **Backtest corrélé** — moteur multi-TF 90 j (pas RSI seul)
- **Baleines / Macro / Lab** — inchangés + prefs sureté max

## Un seul projet Vercel

Reste sur **boriazbot-v4**. Pas de v5. Si les variables sont déjà collées sur v4 → **ne rien refaire**.

### Lien pour mettre à jour les clés

[https://vercel.com/boriaz-bot/boriazbot-v4/settings/environment-variables](https://vercel.com/boriaz-bot/boriazbot-v4/settings/environment-variables)

Tout en **Environment Variables / Secret / Production**. Détail : `CLES-API.md`.

### Upstash en une phrase

Sans Upstash, Vercel jette le paper 1000 € à chaque redémarrage (`/tmp`). Avec Upstash (gratuit), le compte simu reste. Lab → section Clés.

### Cron 15 min — quoi faire avec le lien ?

Hobby Vercel ne lance le cron intégré qu’**1×/jour**. Pour 15 min :

1. Crée un job sur [cron-job.org](https://cron-job.org) (ou équivalent)
2. Méthode **GET**
3. URL (remplace le secret si tu l’as changé) :

```
https://boriazbot-v4.vercel.app/api/cron?secret=TON_CRON_SECRET
```

4. Intervalle : toutes les **15 minutes**
5. C’est tout — ce lien réveille le bot (prix, Alignement, signaux TG, macro T−30)

Test manuel :

```bash
curl "https://boriazbot-v4.vercel.app/api/cron?secret=TON_CRON_SECRET"
```

### Domaine custom

Dans Vercel → projet **boriazbot-v4** → Settings → Domains → ajoute `boriazbot.com` (ou autre). L’URL `*.vercel.app` reste valide.

## Stack

Next.js, TypeScript, Tailwind, shadcn/ui. Hyperliquid public ; Nansen / OpenAI / Anthropic / Telegram / Upstash optionnels.
