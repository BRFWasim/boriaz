# Baleines Hyperliquid

Dashboard web de suivi des **10 plus gros traders perpétuels** (« baleines ») du leaderboard Hyperliquid. Une seule page, données 100 % publiques, **aucune clé API**.

Ce n’est **pas un conseil financier**. Les positions peuvent changer en quelques secondes. Un stop-loss ou un take-profit n’est affiché que s’il existe réellement en carnet — jamais inventé.

## Lancer en local

```bash
npm install
npm run dev
```

Ouvrir [http://127.0.0.1:4317](http://127.0.0.1:4317).

## Ce que la page montre

Pour chaque baleine :

- alias (ou `Baleine #rang`), rang leaderboard, adresse tronquée copiable
- valeur du compte perps, PnL 24h, win rate (clôtures des fills récents)
- positions ouvertes : crypto, long/short, taille en $ et en quantité, levier, prix d’entrée, mark, PnL latent, SL/TP s’ils sont posés (avec distance en % au mark), heure d’ouverture (date + « il y a X »)
- historique des clôtures récentes : entrée → sortie, SL/TP touché le cas échéant, PnL réalisé

Filtres : recherche alias/adresse, tri (portefeuille, PnL 24h, nombre de positions), filtre par crypto.

Interface **Simple** (cartes, lisible au pouce) ou **Avancé** (tableau complet sur bureau, cartes détaillées sur téléphone). Le choix est mémorisé.

Les positions sont relues **toutes les ~20 secondes**. Si une baleine clôture pour en ouvrir une autre, la nouvelle position apparaît au cycle suivant (ce n’est pas du tick-par-tick).

### Téléphone et ordinateur

C’est une PWA autonome : ouvrez l’URL, puis installez-la.

- iPhone / iPad : bouton Partager → **Sur l’écran d’accueil**
- Android / Chrome / bureau : **Installer l’application** dans la barre d’adresse

## Données

| Besoin | Source |
| --- | --- |
| Classement des plus gros portefeuilles | Leaderboard public Hyperliquid (`stats-data.hyperliquid.xyz/Mainnet/leaderboard`). Le `POST /info` avec `type: "leaderboard"` n’est pas exposé par l’API info actuelle ; repli automatique si jamais il le devient. |
| Capitaux et positions | `POST https://api.hyperliquid.xyz/info` · `clearinghouseState` |
| SL / TP (ordres déclencheurs) | `frontendOpenOrders` (repli `openOrders`) |
| Heure d’ouverture, win rate, clôtures | `userFills` |
| SL/TP touché à la clôture | `historicalOrders` |
| Prix de marché | `metaAndAssetCtxs` |

Les 10 adresses sont celles du **plus gros portefeuille leaderboard** qui ont un **compte perps actif** (positions ouvertes ou capitaux perps). Les wallets 100 % spot, sans activité perpétuels, sont écartés.

Rafraîchissement des positions toutes les **20 secondes** (cache serveur). L’historique des fills est relu si le set de positions change, sinon toutes les 60 s.

## Stack

Next.js (App Router), TypeScript, Tailwind CSS, shadcn/ui.
