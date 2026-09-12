import { bindUserRequest } from "@/lib/bind-request";
import { manageOpenTrades } from "@/lib/manage-trades";
import {
  loadLiveManageSnapshots,
  manageLivePositionReviews,
} from "@/lib/manage-live-positions";
import {
  aggregatePaperAccount,
  ensurePortfolios,
  loadPrefs,
} from "@/lib/persist";
import { invalidateTradeSignalsCache } from "@/lib/trade-signal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 90;

/**
 * POST /api/manage
 * body: { fast?: boolean } — fast=true : PnL+règles sans IA ni SMC lourd (poll UI ~45s)
 * LIVE d’abord (analyses positions ouvertes), puis paper — indépendants.
 */
export async function POST(request: Request) {
  try {
    await bindUserRequest();
    let fast = false;
    try {
      const body = (await request.json()) as { fast?: boolean };
      fast = Boolean(body?.fast);
    } catch {
      /* no body */
    }

    // LIVE EN PREMIER : les analyses wallet ne doivent pas attendre le paper
    let live: Awaited<ReturnType<typeof manageLivePositionReviews>> | null =
      null;
    try {
      live = await manageLivePositionReviews({
        notify: !fast,
        skipAi: fast,
        // LIVE : garder SMC (FVG/BOS) même en fast — peu de positions.
        // Timeout TF interne évite le blocage ; fallback mid+PnL si HL lent.
        skipSmc: false,
        max: fast ? 8 : 12,
      });
    } catch {
      live = {
        reviewed: 0,
        decisions: [],
        telegramSent: false,
        aiUsed: false,
        snapshots: await loadLiveManageSnapshots().catch(() => ({})),
      };
    }

    let result: Awaited<ReturnType<typeof manageOpenTrades>> = {
      reviewed: 0,
      decisions: [],
      telegramSent: false,
      aiUsed: false,
      trades: [],
    };
    try {
      result = await manageOpenTrades({
        notify: !fast,
        skipAi: fast,
        skipSmc: fast,
        max: fast ? 8 : 12,
      });
      invalidateTradeSignalsCache();
    } catch {
      /* paper ne doit pas bloquer la réponse live */
      try {
        invalidateTradeSignalsCache();
      } catch {
        /* ignore */
      }
    }

    const prefs = await loadPrefs();
    return Response.json({
      ...result,
      trades: result.trades ?? [],
      account: aggregatePaperAccount(
        result.trades ?? [],
        ensurePortfolios(prefs.portfolios),
      ),
      live: live
        ? {
            reviewed: live.reviewed,
            decisions: live.decisions,
            snapshots: live.snapshots,
            aiUsed: live.aiUsed,
          }
        : null,
      fetchedAt: Date.now(),
      mode: fast ? "fast" : "full",
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Gestion impossible" },
      { status: 400 },
    );
  }
}
