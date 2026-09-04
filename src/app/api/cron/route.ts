import { runMacroT30Alerts } from "@/lib/macro-alerts";
import { getTradeSignals } from "@/lib/trade-signal";
import { runPriceWatch } from "@/lib/price-watch";
import { getBtcAnalysis } from "@/lib/btc-analysis";
import { bindCronRequest } from "@/lib/bind-request";

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
  bindCronRequest();

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

  try {
    const { trackFollowedWallets } = await import("@/lib/wallet-track");
    results.walletTrack = await trackFollowedWallets({
      notify: true,
      autoFollow: true,
    });
  } catch (e) {
    results.walletTrackError = e instanceof Error ? e.message : "wallets";
  }

  // Relecture IA de chaque trade ouvert (fermer / basculer / attendre / laisser),
  // pour le bot par défaut ET chaque utilisateur ayant des positions.
  try {
    const { manageOpenTrades } = await import("@/lib/manage-trades");
    const { listUserIds } = await import("@/lib/accounts");
    const { setPersistUser } = await import("@/lib/persist");
    const manage: Record<string, unknown> = {};
    setPersistUser("default");
    manage.default = await manageOpenTrades({ notify: true });
    const ids = await listUserIds(40);
    for (const id of ids) {
      setPersistUser(id);
      const r = await manageOpenTrades({ notify: true });
      if (r.reviewed > 0) manage[id] = r;
    }
    setPersistUser("default");
    results.manage = manage;
  } catch (e) {
    results.manageError = e instanceof Error ? e.message : "manage";
  }

  return Response.json({ ok: true, ...results });
}
