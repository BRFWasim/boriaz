import { runMacroT30Alerts } from "@/lib/macro-alerts";
import { getTradeSignals } from "@/lib/trade-signal";
import { runPriceWatch } from "@/lib/price-watch";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return true; // local / sans secret
  const header = request.headers.get("authorization") || "";
  const url = new URL(request.url);
  const q = url.searchParams.get("secret");
  return header === `Bearer ${secret}` || q === secret;
}

/**
 * Cron Vercel : bilans prix + signaux LONG/SHORT + macro T−30.
 * Planifier toutes les 10–15 min.
 */
export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Record<string, unknown> = { at: Date.now() };

  try {
    results.priceWatch = await runPriceWatch();
  } catch (e) {
    results.priceWatchError = e instanceof Error ? e.message : "price";
  }

  try {
    const signals = await getTradeSignals({ notify: true, force: true });
    results.signals = {
      best: signals.best
        ? {
            coin: signals.best.coin,
            action: signals.best.action,
            confidence: signals.best.confidence,
            entry: signals.best.entry,
            tp: signals.best.tp,
            sl: signals.best.sl,
          }
        : null,
      telegramSent: signals.telegramSent,
      telegramError: signals.telegramError,
      paperOpen: signals.paper.filter((p) => p.status === "open").length,
    };
  } catch (e) {
    results.signalsError = e instanceof Error ? e.message : "signals";
  }

  try {
    results.macroT30 = await runMacroT30Alerts();
  } catch (e) {
    results.macroError = e instanceof Error ? e.message : "macro";
  }

  return Response.json({ ok: true, ...results });
}
