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
        fetchedAt: Date.now(),
        nextRefreshSec: 45,
      },
      { status: 502 },
    );
  }
}
