import { saveCronStatus } from "@/lib/cron-status";
import { bindCronRequest } from "@/lib/bind-request";

export type CronPhase = "all" | "manage" | "signals";

function withBudget<T>(
  label: string,
  ms: number,
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  return Promise.race([
    fn()
      .then((value) => ({ ok: true as const, value }))
      .catch((e) => ({
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
      })),
    new Promise<{ ok: false; error: string }>((resolve) =>
      setTimeout(
        () => resolve({ ok: false, error: `${label} timeout ${ms}ms` }),
        ms,
      ),
    ),
  ]);
}

/**
 * Travail réel du bot. Budgets stricts pour ne plus timeout Vercel 120s
 * (sinon after() meurt avant saveCronStatus → lastCron null → paper mort).
 */
export async function runCronWork(phase: CronPhase = "all"): Promise<{
  at: number;
  phase: CronPhase;
  results: Record<string, unknown>;
  ok: boolean;
}> {
  bindCronRequest();
  const started = Date.now();
  const results: Record<string, unknown> = {
    at: started,
    phase,
    tick: "bg-lean",
  };

  // Heartbeat immédiat — prouve que le cron tourne même si le reste timeout
  try {
    await saveCronStatus({
      at: started,
      ok: true,
      tick: `${phase}:start`,
      note: "heartbeat",
    });
  } catch {
    /* ignore */
  }

  const wantManage = phase === "all" || phase === "manage";
  const wantSignals = phase === "all" || phase === "signals";

  if (wantManage) {
    const manageBudget = phase === "manage" ? 90_000 : 45_000;
    const m = await withBudget("manage", manageBudget, async () => {
      const out: Record<string, unknown> = {};
      try {
        const { reconcileLiveVsJournal } = await import("@/lib/arch-guards");
        out.reconcile = await reconcileLiveVsJournal();
      } catch (e) {
        out.reconcileError = e instanceof Error ? e.message : "reconcile";
      }

      const { manageOpenTrades } = await import("@/lib/manage-trades");
      const { manageLiveSmcPositions } = await import("@/lib/hl-live");
      const { setPersistUser } = await import("@/lib/persist");

      setPersistUser("default");
      out.default = await manageOpenTrades({ notify: true });
      try {
        out.liveSmc = await manageLiveSmcPositions();
      } catch (e) {
        out.liveSmcError = e instanceof Error ? e.message : "liveSmc";
      }
      try {
        const { cleanupStaleLiveLimits } = await import("@/lib/live-cleanup");
        out.liveCleanup = await cleanupStaleLiveLimits();
      } catch (e) {
        out.liveCleanupError = e instanceof Error ? e.message : "cleanup";
      }
      try {
        const {
          detectStopOutsAndArmCooldown,
          widenTightLiveStops,
        } = await import("@/lib/live-protect");
        out.stopOuts = await detectStopOutsAndArmCooldown();
        out.widenStops = await widenTightLiveStops();
      } catch (e) {
        out.liveProtectError = e instanceof Error ? e.message : "protect";
      }
      try {
        const { checkArmedZonesAndScan } = await import("@/lib/zone-watch");
        out.zoneWatch = await checkArmedZonesAndScan();
      } catch (e) {
        out.zoneWatchError = e instanceof Error ? e.message : "zone";
      }
      // liveReview / multi-users : skip en phase all (trop lent) — manage only
      if (phase === "manage") {
        try {
          const { manageLivePositionReviews } = await import(
            "@/lib/manage-live-positions"
          );
          out.liveReview = await manageLivePositionReviews({ notify: true });
        } catch (e) {
          out.liveReviewError = e instanceof Error ? e.message : "liveReview";
        }
      }
      return out;
    });
    if (m.ok) results.manage = m.value;
    else results.manageError = m.error;
  }

  if (wantSignals) {
    const sigBudget = phase === "signals" ? 95_000 : 55_000;
    const s = await withBudget("signals", sigBudget, async () => {
      const out: Record<string, unknown> = {};
      try {
        out.priceWatch = await (
          await import("@/lib/price-watch")
        ).runPriceWatch();
      } catch (e) {
        out.priceWatchError = e instanceof Error ? e.message : "price";
      }

      const signals = await (
        await import("@/lib/trade-signal")
      ).getTradeSignals({ notify: true, force: true });
      const { isLiveEnvReady, getLiveConfig } = await import("@/lib/hl-live");
      const liveReady = isLiveEnvReady();
      const liveCfg = getLiveConfig();
      out.signals = {
        best: signals.best
          ? {
              coin: signals.best.coin,
              action: signals.best.action,
              confidence: signals.best.confidence,
              certainty: signals.best.certainty,
            }
          : null,
        paperOpen: signals.paper.filter((p) => p.status === "open").length,
        paperPending: signals.paper.filter((p) => p.status === "pending")
          .length,
        telegramSent: signals.telegramSent,
        live: {
          envReady: liveReady.ok,
          envArmed: liveCfg.envArmed,
          allowShort: liveCfg.allowShort,
          reason: liveReady.reason ?? null,
        },
      };
      try {
        const { repairNakedLiveTpsl } = await import("@/lib/hl-live");
        out.liveRepairAfterSignals = await repairNakedLiveTpsl();
      } catch (e) {
        out.liveRepairAfterSignalsError =
          e instanceof Error ? e.message : "repair";
      }
      return out;
    });
    if (s.ok) {
      Object.assign(results, s.value);
    } else {
      results.signalsError = s.error;
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
      note: ok
        ? `ok-bg ${Date.now() - started}ms`
        : `partial-bg ${Date.now() - started}ms`,
    });
  } catch {
    /* ignore */
  }

  return { at: Date.now(), phase, results, ok: Boolean(ok) };
}
