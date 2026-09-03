import { promises as fs } from "fs";
import path from "path";
import type { IntegrationStatus } from "./types";

export function getIntegrationStatus(): IntegrationStatus {
  const openai = Boolean(process.env.OPENAI_API_KEY?.trim());
  const anthropic = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  const telegramToken = Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim());
  const arkham = Boolean(process.env.ARKHAM_API_KEY?.trim());
  const nansen = Boolean(process.env.NANSEN_API_KEY?.trim());
  const coingecko = true;
  const missingKeys: string[] = [];
  if (!openai) missingKeys.push("OPENAI_API_KEY");
  if (!anthropic) missingKeys.push("ANTHROPIC_API_KEY");
  if (!telegramToken) missingKeys.push("TELEGRAM_BOT_TOKEN");
  if (!process.env.TELEGRAM_CHAT_ID?.trim()) {
    missingKeys.push("TELEGRAM_CHAT_ID (ou /start @BoriazBot + lien auto)");
  }
  if (!arkham) missingKeys.push("ARKHAM_API_KEY");
  if (!nansen) missingKeys.push("NANSEN_API_KEY");
  if (!process.env.COINGECKO_API_KEY?.trim()) {
    missingKeys.push("COINGECKO_API_KEY (optionnel)");
  }

  return {
    hyperliquid: true,
    coingecko,
    openai,
    anthropic,
    telegram: telegramToken,
    arkham,
    nansen,
    missingKeys,
  };
}

export async function hasTelegramChatLinked(): Promise<boolean> {
  if (
    process.env.TELEGRAM_CHAT_ID &&
    /^-?\d+$/.test(process.env.TELEGRAM_CHAT_ID.trim())
  ) {
    return true;
  }
  try {
    const saved = (
      await fs.readFile(path.join(process.cwd(), ".telegram-chat-id"), "utf8")
    ).trim();
    return /^-?\d+$/.test(saved);
  } catch {
    return false;
  }
}
