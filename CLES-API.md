# Clés API — quoi envoyer au prochain prompt

Tu n’as **besoin d’aucune clé** pour :
- Top 10 baleines Hyperliquid (perps)
- Positions, SL/TP, funding, liquidation
- Spot Hyperliquid + alerte short+spot
- RSI / MACD / EMA / Bollinger BTC (bougies Hyperliquid)
- Contexte CoinGecko en mode public (peut rate-limit)

## Priorité haute (pour l’IA BTC)

1. **OPENAI_API_KEY** — https://platform.openai.com/api-keys  
   (ou **ANTHROPIC_API_KEY** — https://console.anthropic.com/)

## Priorité moyenne

2. **COINGECKO_API_KEY** (Pro, optionnel) — https://www.coingecko.com/en/api  
3. **TELEGRAM_BOT_TOKEN** + **TELEGRAM_CHAT_ID** — https://t.me/BotFather + @userinfobot  
   → pour notifier quand une baleine short avec du spot / gros achat spot

## Priorité basse (plus de portefeuilles / labels hors HL)

4. **ARKHAM_API_KEY** — https://platform.arkhamintelligence.com/  
5. **NANSEN_API_KEY** — https://app.nansen.ai/  

Hyperliquid seul donne déjà **tous les wallets publics**.  
Arkham/Nansen servent surtout à **nommer** des adresses, voir des flux CEX, et élargir hors Hyperliquid.

## Telegram (@BoriazBot)

1. Ouvre https://t.me/BoriazBot  
2. Envoie `/start`  
3. Dans l’onglet **Analyse BTC**, clique **Lier Telegram** puis **Envoyer un test**

Tu recevras :
- alertes **short + spot**
- accumulations spot notables
- timings BTC (zone d’achat / biais baissier)

`t.me/BoriazBot` n’est **pas** un chat ID : c’est le bot. Le chat ID numérique est capturé après ton `/start`.
