import { promises as fs } from "fs";
import { dataPath, ensureDataDir } from "./data-dir";

function chatFile() {
  return dataPath(".telegram-chat-id");
}

export function getTelegramToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
}

export async function resolveChatId(): Promise<string | null> {
  const fromEnv = process.env.TELEGRAM_CHAT_ID?.trim();
  if (fromEnv && /^-?\d+$/.test(fromEnv)) return fromEnv;
  try {
    const saved = (await fs.readFile(chatFile(), "utf8")).trim();
    if (/^-?\d+$/.test(saved)) return saved;
  } catch {
    // ignore
  }
  return null;
}

export async function saveChatId(chatId: string): Promise<void> {
  await ensureDataDir();
  await fs.writeFile(chatFile(), `${chatId}\n`, "utf8");
}

export async function discoverChatIdFromUpdates(): Promise<{
  chatId: string | null;
  username: string | null;
  detail: string;
}> {
  const token = getTelegramToken();
  if (!token) {
    return { chatId: null, username: null, detail: "TELEGRAM_BOT_TOKEN manquant" };
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, {
    cache: "no-store",
  });
  const json = (await res.json()) as {
    ok: boolean;
    result?: {
      message?: {
        text?: string;
        chat?: { id: number; username?: string; first_name?: string; type: string };
      };
    }[];
  };
  if (!json.ok) {
    return { chatId: null, username: null, detail: "getUpdates a échoué" };
  }
  const updates = json.result ?? [];
  for (let i = updates.length - 1; i >= 0; i--) {
    const chat = updates[i]?.message?.chat;
    if (chat?.id != null) {
      const id = String(chat.id);
      await saveChatId(id);
      return {
        chatId: id,
        username: chat.username ?? chat.first_name ?? null,
        detail: `Chat capturé depuis un message Telegram (${chat.type}).`,
      };
    }
  }
  return {
    chatId: null,
    username: null,
    detail:
      "Aucun message reçu. Ouvre Telegram, cherche @BoriazBot, envoie /start, puis reclique « Lier Telegram ».",
  };
}

export async function sendTelegramMessage(text: string): Promise<{
  ok: boolean;
  error?: string;
}> {
  const token = getTelegramToken();
  const chatId = await resolveChatId();
  if (!token) return { ok: false, error: "TELEGRAM_BOT_TOKEN manquant" };
  if (!chatId) {
    return {
      ok: false,
      error:
        "TELEGRAM_CHAT_ID manquant. Envoie /start à @BoriazBot puis lie le chat depuis l’app.",
    };
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });
  const json = (await res.json()) as { ok: boolean; description?: string };
  if (!json.ok) return { ok: false, error: json.description || `HTTP ${res.status}` };
  return { ok: true };
}
