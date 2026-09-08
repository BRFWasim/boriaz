import { saveCronStatus } from "@/lib/cron-status";
import { bindCronRequest } from "@/lib/bind-request";

export type CronPhase = "all" | "manage" | "signals";

/**
 * Travail réel du bot. Appelé en arrière-plan après l’ACK HTTP
 * (cron-job.org timeout 30s → on répond en <2s, on continue jusqu’à maxDuration).
 */
export async function runCronWork(phase: CronPhase = "all"): Promise<{
  at: number;
  phase: CronPhase;
  results: Record<string, unknown>;
  ok: boolean;
}> {
  bindCronRequest();
  const results: Record<string, unknown> = {
    at: Date.now(),
    phase,
    tick: "bg",
  };

  const wantManage = phase === "all" || phase === "manage";
  const wantSignals = phase === "all" || phase === "signals";

  // 1) PRIORITÉ : trades déjà ouverts (paper + live SMC) — avant le reste
  if (wantManage) {
    try {
      const { manageOpenTrades } = await import("@/lib/manage-trades");
      const { manageLiveSmcPositions } = await import("@/lib/hl-live");
      const { listUserIds } = await import("@/lib/accounts");
      const { setPersistUser } = await import("@/lib/persist");

      const manage: Record<string, unknown> = {};
      setPersistUser("default");
      manage.default = await manageOpenTrades({ notify: true });
      try {
        manage.liveSmc = await manageLiveSmcPositions();
      } catch (e) {
        manage.liveSmcError = e instanceof Error ? e.message : "liveSmc";
      }
      try {
        const { manageLivePositionReviews } = await import(
          "@/lib/manage-live-positions"
        );
        manage.liveReview = await manageLivePositionReviews({ notify: true });
      } catch (e) {
        manage.liveReviewError = e instanceof Error ? e.message : "liveReview";
      }
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
  }

  // 2) Nouveaux signaux / paper / live entries
  if (wantSignals) {
    try {
      results.priceWatch = await (
        await import("@/lib/price-watch")
      ).runPriceWatch();
    } catch (e) {
      results.priceWatchError = e instanceof Error ? e.message : "price";
    }

    try {
      const signals = await (
        await import("@/lib/trade-signal")
      ).getTradeSignals({ notify: true, force: true });
      const { isLiveEnvReady, getLiveConfig } = await import("@/lib/hl-live");
      const liveReady = isLiveEnvReady();
      const liveCfg = getLiveConfig();
      results.signals = {
        best: signals.best
          ? {
              coin: signals.best.coin,
              action: signals.best.action,
              confidence: signals.best.confidence,
              certainty: signals.best.certainty,
            }
          : null,
        paperOpen: signals.paper.filter((p) => p.status === "open").length,
        telegramSent: signals.telegramSent,
        live: {
          envReady: liveReady.ok,
          envArmed: liveCfg.envArmed,
          reason: liveReady.reason ?? null,
        },
      };
    } catch (e) {
      results.signalsError = e instanceof Error ? e.message : "signals";
    }

    // Analyse BTC : utile mais secondaire (souvent long) — après signaux
    try {
      const analysis = await (
        await import("@/lib/btc-analysis")
      ).getBtcAnalysis({
        includeAi: true,
        notify: false,
        force: true,
      });
      results.analysis = { btcBias: analysis.bias };
    } catch (e) {
      results.analysisError = e instanceof Error ? e.message : "analysis";
    }

    try {
      results.macroT30 = await (
        await import("@/lib/macro-alerts")
      ).runMacroT30Alerts();
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
  }

  const ok =
    !results.manageError &&
    !results.signalsError &&
    !results.priceWatchError;

  try {
    await saveCronStatus({
      at: Date.now(),
      ok: Boolean(ok),
      tick: phase,
      note: ok ? "ok-bg" : "partial-bg",
    });
  } catch {
    /* ignore */
  }

  return { at: Date.now(), phase, results, ok: Boolean(ok) };
}
