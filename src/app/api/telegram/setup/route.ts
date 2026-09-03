import {
  discoverChatIdFromUpdates,
  resolveChatId,
  sendTelegramMessage,
} from "@/lib/telegram";

export const dynamic = "force-dynamic";

export async function GET() {
  const linked = await resolveChatId();
  return Response.json({
    linked: Boolean(linked),
    chatIdPreview: linked ? `${linked.slice(0, 3)}…${linked.slice(-2)}` : null,
    bot: "@BoriazBot",
    instruction:
      "Ouvre Telegram → @BoriazBot → envoie /start → puis POST /api/telegram/setup",
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
  };
  const action = body.action || "link";

  if (action === "link") {
    const discovered = await discoverChatIdFromUpdates();
    if (discovered.chatId) {
      await sendTelegramMessage(
        "BoriazBot lié ✅\nTu recevras les alertes baleines (short+spot) et les timings BTC.\nPas un conseil financier.",
      );
    }
    return Response.json(discovered);
  }

  if (action === "test") {
    const result = await sendTelegramMessage(
      "Test BoriazBot ✅\nLes alertes baleines + BTC sont actives.\nPas un conseil financier.",
    );
    return Response.json(result);
  }

  return Response.json({ ok: false, error: "action inconnue" }, { status: 400 });
}
