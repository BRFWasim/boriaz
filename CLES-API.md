# Clés API — quoi envoyer au prochain prompt

Tu n’as **besoin d’aucune clé** pour :
- Top 10 baleines Hyperliquid (perps)
- Positions, SL/TP, funding, liquidation
- Spot Hyperliquid + alerte short+spot
- RSI / MACD / EMA / Bollinger multi-TF (bougies Hyperliquid)
- Zones d’achat idéales (règles locales, 0 token IA)
- Watchlist prix + % (RENDER, ONDO, UNI, BTC, SOL, ETH, HYPE, TAO)
- Contexte CoinGecko en mode public (peut rate-limit)

## Priorité haute (IA optionnelle — bouton « Avis IA »)

1. **OPENAI_API_KEY** — https://platform.openai.com/api-keys  
   et/ou **ANTHROPIC_API_KEY** — https://console.anthropic.com/

Optimisation tokens : l’IA n’est **pas** appelée au refresh auto. Uniquement sur clic, puis **cache 45 min**, prompts courts, `max_tokens` ~420.

## Priorité moyenne

2. **COINGECKO_API_KEY** (Demo/Pro, optionnel) — https://www.coingecko.com/en/api  
3. **TELEGRAM_BOT_TOKEN** (+ liaison chat via `/start`) — https://t.me/BotFather  

## Priorité basse

4. **ARKHAM_API_KEY** / **NANSEN_API_KEY** — labels hors HL

## Telegram (@BoriazBot)

1. Ouvre https://t.me/BoriazBot  
2. Envoie `/start`  
3. Onglet **Analyse marché** → **Lier Telegram** → **Test** / **Forcer bilan 2h**

Tu recevras :
- **bilan prix** watchlist toutes les **2h** (avec %)
- **notif immédiate** si **+1.5 %** en ~20 min
- alertes **short + spot**
- timings BTC (si conditions)

`t.me/BoriazBot` n’est **pas** un chat ID : c’est le bot. Le chat ID numérique est capturé après ton `/start`.
