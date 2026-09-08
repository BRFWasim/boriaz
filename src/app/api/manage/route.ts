import { bindUserRequest } from "@/lib/bind-request";
import { manageOpenTrades } from "@/lib/manage-trades";
import {
  aggregatePaperAccount,
  ensurePortfolios,
  loadPrefs,
} from "@/lib/persist";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 90;

/**
 * POST /api/manage
 * body: { fast?: boolean } — fast=true : relecture PnL+structure sans IA (poll UI ~45s)
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
    const result = await manageOpenTrades({
      notify: !fast,
      skipAi: fast,
      max: fast ? 8 : 12,
    });
    const prefs = await loadPrefs();
    return Response.json({
      ...result,
      trades: result.trades ?? [],
      account: aggregatePaperAccount(
        result.trades ?? [],
        ensurePortfolios(prefs.portfolios),
      ),
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
