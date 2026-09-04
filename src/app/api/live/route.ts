import { getWatchlistSnapshot } from "@/lib/price-watch";
import {
  aggregatePaperAccount,
  computePaperAccount,
  ensurePortfolios,
  loadPaperTrades,
  loadPrefs,
} from "@/lib/persist";
import { postInfo } from "@/lib/hyperliquid";
import { parseNum } from "@/lib/format";
import { WATCHLIST } from "@/lib/price-watch";
import { bindUserRequest } from "@/lib/bind-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Prix mids ultra-légers + paper mark-to-market. Pas d’écriture FS obligatoire. */
export async function GET() {
  try {
    await bindUserRequest({ follow: false });
    let quotes: {
      coin: string;
      label: string;
      price: number;
      change15mPct: number | null;
      change1hPct: number | null;
      change2hPct: number | null;
    }[] = [];

    try {
      // Mids directs = le plus live possible
      const mids = (await postInfo({ type: "allMids" })) as Record<
        string,
        string
      >;
      quotes = WATCHLIST.map((w) => ({
        coin: w.coin,
        label: w.label,
        price: parseNum(mids[w.coin] ?? "0"),
        change15mPct: null,
        change1hPct: null,
        change2hPct: null,
      })).filter((q) => q.price > 0);

      // Enrichit % si snapshot déjà chaud
      try {
        const snap = await getWatchlistSnapshot();
        const by = new Map(snap.quotes.map((q) => [q.coin, q]));
        quotes = quotes.map((q) => {
          const s = by.get(q.coin);
          return s
            ? {
                ...q,
                change15mPct: s.change15mPct,
                change1hPct: s.change1hPct,
                change2hPct: s.change2hPct,
              }
            : q;
        });
      } catch {
        // ignore
      }
    } catch {
      const snap = await getWatchlistSnapshot();
      quotes = snap.quotes;
    }

    const prefs = await loadPrefs().catch(() => null);
    const trades = await loadPaperTrades().catch(() => []);
    const prices: Record<string, number> = {};
    for (const q of quotes) prices[q.coin] = q.price;

    for (const t of trades) {
      const px = prices[t.coin];
      if (!px || t.status !== "open") continue;
      t.markPx = px;
      const movePct =
        t.side === "long"
          ? ((px - t.entry) / t.entry) * 100
          : ((t.entry - px) / t.entry) * 100;
      t.pnlPct = movePct * t.leverage;
      t.pnlEur = t.marginEur * (t.pnlPct / 100) - (t.feesEur ?? 0);
    }

    const account = aggregatePaperAccount(
      trades,
      ensurePortfolios(prefs?.portfolios),
    );
    // Comptes par portefeuille (pour un affichage cohérent section ↔ total)
    const portfolioAccounts = ensurePortfolios(prefs?.portfolios).map((p) => ({
      ...computePaperAccount(trades, p.bankrollEur, p.id),
      portfolioName: p.name,
    }));

    return Response.json({
      quotes,
      account,
      portfolioAccounts,
      paper: trades.slice(0, 40),
      fetchedAt: Date.now(),
    });
  } catch (e) {
    return Response.json(
      {
        error: e instanceof Error ? e.message : "Live indisponible",
        quotes: [],
        fetchedAt: Date.now(),
      },
      { status: 200 },
    );
  }
}
