# Clés — où les coller (un seul projet)

**Lien unique :** [Variables d’environnement boriazbot-v4](https://vercel.com/boriaz-bot/boriazbot-v4/settings/environment-variables)

Tout en **Environment Variables** (cadenas / Secret), Environment = **Production**.  
Pas dans le chat. Pas dans un fichier « configuration » à part.

## Upstash, en une phrase

Vercel n’a pas de disque. `/tmp` = un brouillon jeté à chaque redémarrage.  
**Upstash** = un petit tiroir Redis gratuit qui garde le paper 1000 € et le journal.

1. [console.upstash.com](https://console.upstash.com) → Create Redis (free)
2. Copier **REST URL** + **REST TOKEN**
3. Les coller sur Vercel :
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

Sans ça, le compte simu peut revenir à 1000 € après un cold start (le navigateur essaie quand même de le recopier).

## Checklist (Production, projet v4 seulement)

| Variable | Obligatoire ? | Pour quoi |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Oui pour TG | Bot @BoriazBot |
| `TELEGRAM_CHAT_ID` | Oui pour TG | Ton chat (ex. déjà 846787235) |
| `CRON_SECRET` | Oui pour cron 15 min | Même secret que dans l’URL cron |
| `OPENAI_API_KEY` | Fortement | IA toutes cryptos |
| `ANTHROPIC_API_KEY` | Fortement | IA Claude (batch watchlist) |
| `NANSEN_API_KEY` | Utile | Smart money / Alignement |
| `UPSTASH_REDIS_REST_URL` | Pour paper durable | Tiroir simu 1000 € |
| `UPSTASH_REDIS_REST_TOKEN` | Pour paper durable | Tiroir simu 1000 € |
| `COINGECKO_API_KEY` | Optionnel | Cap / volumes BTC |
| `ARKHAM_API_KEY` | Optionnel | Labels |

`OPENAI_MODEL` / `ANTHROPIC_MODEL` = configuration (pas secret).

## Cron 15 min

GET `https://boriazbot-v4.vercel.app/api/cron?secret=TON_CRON_SECRET` toutes les 15 min (cron-job.org).
