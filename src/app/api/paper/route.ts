import { loadPaperTrades } from "@/lib/persist";
import { getTradeSignals } from "@/lib/trade-signal";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  // Refresh PnL / invalidations via trade-signal
  try {
    const sig = await getTradeSignals({ notify: false, force: true });
    return Response.json({
      trades: sig.paper,
      fetchedAt: Date.now(),
    });
  } catch {
    const trades = await loadPaperTrades();
    return Response.json({ trades: trades.slice(0, 40), fetchedAt: Date.now() });
  }
}
