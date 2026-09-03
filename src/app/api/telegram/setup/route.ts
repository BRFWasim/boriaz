import { runPriceWatch } from "@/lib/price-watch";
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
      "Ouvre Telegram → @BoriazBot → envoie /start → puis lie depuis l’app",
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
        [
          "BoriazBot lié ✅",
          "Tu recevras :",
          "• bilan prix watchlist toutes les 2h",
          "• notif immédiate si +1.5% rapide (~20 min)",
          "• signaux LONG/SHORT (IA + levier/mise) quand confiance élevée",
          "• pas de notif short+spot (UI only)",
          "Pas un conseil financier.",
        ].join("\n"),
      );
    }
    return Response.json(discovered);
  }

  if (action === "test") {
    const result = await sendTelegramMessage(
      "Test BoriazBot ✅\nBilan 2h + spikes +1.5% + baleines actifs.\nPas un conseil financier.",
    );
    return Response.json(result);
  }

  if (action === "digest") {
    const watch = await runPriceWatch({ forceDigest: true });
    return Response.json({
      ok: watch.digestSent,
      quotes: watch.quotes.length,
      spikesSent: watch.spikesSent,
      errors: watch.errors,
      nextDigestAt: watch.nextDigestAt,
    });
  }

  return Response.json({ ok: false, error: "action inconnue" }, { status: 400 });
}
