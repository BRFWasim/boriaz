import { getWhaleDashboard } from "@/lib/dashboard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const payload = await getWhaleDashboard();
    return Response.json(payload);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Le leaderboard Hyperliquid est indisponible.";
    return Response.json(
      {
        error: message,
        whales: [],
        coins: [],
        overview: {
          whaleCount: 0,
          totalEquity: 0,
          totalGrossExposure: 0,
          totalLongUsd: 0,
          totalShortUsd: 0,
          netBiasUsd: 0,
          bias: "neutre",
          avgWinRate: null,
          totalUnrealized: 0,
          totalPnl24h: 0,
          crowded: [],
          riskiest: [],
        },
        fetchedAt: Date.now(),
        nextRefreshSec: 20,
      },
      { status: 502 },
    );
  }
}
