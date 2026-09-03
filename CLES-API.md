# Clés API — quoi envoyer au prochain prompt

Tu n’as **besoin d’aucune clé** pour :
- Top 10 baleines Hyperliquid (perps + spot)
- Crowd long/short (wallets qualité alignés)
- Alertes prioritaires filtrées
- Watchlist prix + bilans Telegram 2h / spikes +1.5 %
- Analyses techniques multi-TF (0 token IA)

## Publier le site

Dans Cursor : bouton **Publish** (Vercel). Ou manuellement sur [vercel.com](https://vercel.com) en important le repo. Détails dans le README.

## Priorité haute (IA optionnelle)

1. **OPENAI_API_KEY** / **ANTHROPIC_API_KEY** — bouton « Avis IA » uniquement (cache 45 min)

## Priorité moyenne

2. **COINGECKO_API_KEY** (optionnel)  
3. **TELEGRAM_BOT_TOKEN** — `/start` à @BoriazBot puis lier dans l’app

## Hors Hyperliquid

4. **NANSEN_API_KEY** — smart money + leaderboard perps (déjà branché si présent dans `.env.local`)  
5. **ARKHAM_API_KEY** — labels (optionnel)

**Important :** ne colle jamais une clé API dans le chat en production longue — régénère-la sur Nansen si elle a fuité.

## Telegram — ce qui est notifié (filtre prioritaire)

- Crowd short/long synchronisé (wallets WR≥55 % ou méga-equity)
- Short + spot si spot ≥ ~8k$
- Accumulation spot ≥ ~50k$ (sinon UI only)
- Bilan prix 2h + spike +1.5 %
- Zone d’achat BTC claire / biais baissier fort
