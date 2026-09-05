import { getIntegrationStatus } from "@/lib/integrations";
import { kvBackend } from "@/lib/kv";
import { loadCronStatus } from "@/lib/cron-status";

export const dynamic = "force-dynamic";

const VERCEL_ENV_URL =
  "https://vercel.com/boriaz-bot/boriazbot-v4/settings/environment-variables";

export async function GET() {
  const integ = getIntegrationStatus();
  const upstash = kvBackend() === "upstash";
  const cron = Boolean(process.env.CRON_SECRET?.trim());
  const keys = {
    OPENAI_API_KEY: integ.openai,
    ANTHROPIC_API_KEY: integ.anthropic,
    TELEGRAM_BOT_TOKEN: integ.telegram,
    TELEGRAM_CHAT_ID: Boolean(process.env.TELEGRAM_CHAT_ID?.trim()),
    NANSEN_API_KEY: integ.nansen,
    COINGECKO_API_KEY: Boolean(process.env.COINGECKO_API_KEY?.trim()),
    CRON_SECRET: cron,
    UPSTASH_REDIS_REST_URL: Boolean(
      process.env.UPSTASH_REDIS_REST_URL?.trim(),
    ),
    UPSTASH_REDIS_REST_TOKEN: Boolean(
      process.env.UPSTASH_REDIS_REST_TOKEN?.trim(),
    ),
  };
  const missing = Object.entries(keys)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);

  const lastCron = await loadCronStatus();

  return Response.json({
    lastCron,
    keys,
    missing,
    storage: upstash ? "upstash" : "tmp",
    vercelEnvUrl: VERCEL_ENV_URL,
    upstashUrl: "https://console.upstash.com",
    howto: {
      where:
        "Vercel → projet boriazbot-v4 → Settings → Environment Variables. Tout en Secret / Production. Pas en chat.",
      upstash:
        "Upstash = un petit tiroir en ligne pour le paper 1000 €. Sans ça, Vercel jette le tiroir à chaque redémarrage (/tmp). Gratuit : Redis → REST URL + TOKEN.",
    },
  });
}
