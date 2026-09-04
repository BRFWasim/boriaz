import { bindUserRequest } from "@/lib/bind-request";
import { manageOpenTrades } from "@/lib/manage-trades";
import {
  aggregatePaperAccount,
  ensurePortfolios,
  loadPaperTrades,
  loadPrefs,
} from "@/lib/persist";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 90;

/** Relit chaque trade ouvert de l'utilisateur avec les 2 IA (+ repli règles). */
export async function POST() {
  try {
    await bindUserRequest();
    const result = await manageOpenTrades({ notify: true });
    const [prefs, trades] = await Promise.all([loadPrefs(), loadPaperTrades()]);
    return Response.json({
      ...result,
      trades: trades.slice(0, 40),
      account: aggregatePaperAccount(trades, ensurePortfolios(prefs.portfolios)),
      fetchedAt: Date.now(),
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Gestion impossible" },
      { status: 400 },
    );
  }
}
