import type { IntegrationStatus } from "./types";

export function getIntegrationStatus(): IntegrationStatus {
  const openai = Boolean(process.env.OPENAI_API_KEY?.trim());
  const anthropic = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  const telegram = Boolean(
    process.env.TELEGRAM_BOT_TOKEN?.trim() &&
      process.env.TELEGRAM_CHAT_ID?.trim(),
  );
  const arkham = Boolean(process.env.ARKHAM_API_KEY?.trim());
  const nansen = Boolean(process.env.NANSEN_API_KEY?.trim());
  const coingecko = true; // endpoint public ; clé pro optionnelle
  const missingKeys: string[] = [];
  if (!openai) missingKeys.push("OPENAI_API_KEY");
  if (!anthropic) missingKeys.push("ANTHROPIC_API_KEY");
  if (!telegram) missingKeys.push("TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID");
  if (!arkham) missingKeys.push("ARKHAM_API_KEY");
  if (!nansen) missingKeys.push("NANSEN_API_KEY");
  if (!process.env.COINGECKO_API_KEY?.trim()) {
    missingKeys.push("COINGECKO_API_KEY (optionnel Pro)");
  }

  return {
    hyperliquid: true,
    coingecko,
    openai,
    anthropic,
    telegram,
    arkham,
    nansen,
    missingKeys,
  };
}
