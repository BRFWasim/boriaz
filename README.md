# Baleines Hyperliquid

Dashboard web de suivi des **10 plus gros traders perpétuels** (« baleines ») du leaderboard Hyperliquid. Une seule page, données 100 % publiques, **aucune clé API**.

Ce n’est **pas un conseil financier**. Les positions peuvent changer en quelques secondes. Un stop-loss ou un take-profit n’est affiché que s’il existe réellement en carnet — jamais inventé.

## Lancer en local

```bash
npm install
npm run dev
```

Ouvrir [http://127.0.0.1:4317](http://127.0.0.1:4317).

Build production :

```bash
npm run build
npm start
```

## Ce que la page montre

### Vue marché (agrégat des 10)
- Equity totale, exposition brute, longs vs shorts, biais net
- PnL latent et PnL 24h agrégés
- Cryptos les plus suivies (nombre de baleines, long/short/net, funding 8h)
- Win rate moyen et profils les plus risqués (score interne)

### Par baleine
- Alias / rang, adresse tronquée copiable
- Portefeuille perps, PnL & ROI (24h / 7j / 30j / all-time), volume 24h
- Win rate, profit factor, expectancy, frais (sur l’échantillon de fills)
- Exposition long/short, levier moyen, marge utilisée, withdrawable
- PnL latent, funding depuis ouverture, concentration, positions near-liq
- Score de risque (0–100) : levier, marge, proximité liquidation, SL absents, concentration
- Positions : crypto, sens, taille $, qty, levier, entrée, mark, move %, liq + distance %, funding, SL/TP, heure d’ouverture
- Clôtures récentes : entrée→sortie, PnL réalisé, SL/TP touché le cas échéant

Filtres : recherche, tri (portefeuille, PnL 24h, PnL latent, positions, risque, win rate), filtre crypto.

## Onglets

1. **Baleines perps** — top 10, expositions, risque, SL/TP  
2. **Spot & alertes** — soldes spot, entrée moyenne, achats, alerte **short + spot**  
3. **Analyse marché** — BTC multi-TF (1h / 4h / 1d), SOL court+moyen, zones d’achat watchlist (RENDER, ONDO, UNI, BTC, SOL, ETH, HYPE, TAO), bilans Telegram 2h + spikes +1.5 %. IA optionnelle (cache 45 min) pour limiter les tokens.

Voir `CLES-API.md` et `.env.example` pour les clés optionnelles.

### Téléphone et ordinateur (PWA)
- iPhone / iPad : Partager → Sur l’écran d’accueil
- Android / Chrome / bureau : Installer l’application

## Données (aucune clé)

| Besoin | Source |
| --- | --- |
| Classement | `https://stats-data.hyperliquid.xyz/Mainnet/leaderboard` (repli si `info` leaderboard un jour) |
| Capitaux / positions | `POST https://api.hyperliquid.xyz/info` · `clearinghouseState` |
| SL / TP | `frontendOpenOrders` (repli `openOrders`) |
| Fills / win rate / clôtures | `userFills` |
| SL/TP à la clôture | `historicalOrders` |
| Mark, funding, OI, volume | `metaAndAssetCtxs` |

## Stack

Next.js (App Router), TypeScript, Tailwind CSS, shadcn/ui.
