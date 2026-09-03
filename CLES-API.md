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

## Format à coller au prochain message

```
OPENAI_API_KEY=sk-...
COINGECKO_API_KEY=...
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
ARKHAM_API_KEY=...
NANSEN_API_KEY=...
```

(Envoie seulement celles que tu as.)
