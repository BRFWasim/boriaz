import { runMacroT30Alerts } from "@/lib/macro-alerts";
import { getTradeSignals } from "@/lib/trade-signal";
import { runPriceWatch } from "@/lib/price-watch";
import { getBtcAnalysis } from "@/lib/btc-analysis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return true;
  const header = request.headers.get("authorization") || "";
  const url = new URL(request.url);
  const q = url.searchParams.get("secret");
  return header === `Bearer ${secret}` || q === secret;
}

/**
 * À appeler toutes les 15 min (cron-job.org) :
 * prix + analyse multi-TF+IA + signaux corrélés wallets WR + macro T−30.
 * N’envoie Telegram que pour certitude haute / confiance ≥70.
 */
export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Record<string, unknown> = { at: Date.now(), tick: "15m" };

  try {
    results.priceWatch = await runPriceWatch();
  } catch (e) {
    results.priceWatchError = e instanceof Error ? e.message : "price";
  }

  try {
    const analysis = await getBtcAnalysis({
      includeAi: true,
      notify: false,
      force: true,
    });
    const uni = analysis.assetAnalyses?.find((a) => a.coin === "UNI");
    const uniMain =
      uni?.timeframes?.find((f) => f.interval === "1h") ??
      uni?.timeframes?.find((f) => f.interval === "4h") ??
      uni?.timeframes?.[0];
    results.analysis = {
      btcBias: analysis.bias,
      uni: uniMain
        ? {
            bias: uniMain.bias,
            score: uniMain.score,
            frames: uni?.timeframes.map((f) => ({
              i: f.interval,
              b: f.bias,
              s: f.score,
            })),
          }
        : null,
      watchAiSkipped: analysis.watchAi?.skipped ?? null,
    };
  } catch (e) {
    results.analysisError = e instanceof Error ? e.message : "analysis";
  }

  try {
    const signals = await getTradeSignals({ notify: true, force: true });
    results.signals = {
      best: signals.best
        ? {
            coin: signals.best.coin,
            action: signals.best.action,
            confidence: signals.best.confidence,
            certainty: signals.best.certainty,
            tfSummary: signals.best.tfSummary,
            crowdWr: signals.best.crowdWr,
            entry: signals.best.entry,
            tp: signals.best.tp,
            sl: signals.best.sl,
          }
        : null,
      top: signals.signals.slice(0, 5).map((s) => ({
        coin: s.coin,
        action: s.action,
        confidence: s.confidence,
        certainty: s.certainty,
        tf: s.tfSummary,
      })),
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
