import { getWatchlistSnapshot, runPriceWatch } from "@/lib/price-watch";
import { loadPaperTrades, computePaperAccount, loadPrefs } from "@/lib/persist";

export const dynamic = "force-dynamic";

/** Endpoint léger pour prix + paper mark-to-market (~temps réel). */
export async function GET() {
  try {
    await runPriceWatch().catch(() => undefined);
    const [snap, prefs, trades] = await Promise.all([
      getWatchlistSnapshot(),
      loadPrefs(),
      loadPaperTrades(),
    ]);
    const prices: Record<string, number> = {};
    for (const q of snap.quotes) prices[q.coin] = q.price;

    // Mark-to-market rapide sans clôturer
    for (const t of trades) {
      const px = prices[t.coin];
      if (!px || (t.status !== "open" && t.status !== "pending")) continue;
      t.markPx = px;
      if (t.status === "open") {
        const movePct =
          t.side === "long"
            ? ((px - t.entry) / t.entry) * 100
            : ((t.entry - px) / t.entry) * 100;
        t.pnlPct = movePct * t.leverage;
        t.pnlEur = t.marginEur * (t.pnlPct / 100);
      }
    }

    const account = computePaperAccount(
      trades,
      prefs.paperBankrollEur || 1000,
    );

    return Response.json({
      quotes: snap.quotes,
      account,
      paper: trades.filter(
        (t) => t.status === "open" || t.status === "pending",
      ),
      fetchedAt: Date.now(),
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Live indisponible" },
      { status: 502 },
    );
  }
}
