import {
  loadPaperTrades,
  computePaperAccount,
  loadPrefs,
  mergePaperTrades,
  storageInfo,
} from "@/lib/persist";
import { getTradeSignals } from "@/lib/trade-signal";
import type { PaperTrade } from "@/lib/user-types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const sig = await getTradeSignals({ notify: false, force: true });
    return Response.json({
      trades: sig.paper,
      account: sig.account,
      storage: sig.storage,
      fetchedAt: Date.now(),
      howto:
        "Compte virtuel 1000 €. Chaque alerte ouvre une simu. Equity = cash + positions au prix live. Variation = ce que tu aurais gagné/perdu.",
    });
  } catch {
    const [prefs, trades] = await Promise.all([loadPrefs(), loadPaperTrades()]);
    return Response.json({
      trades: trades.slice(0, 40),
      account: computePaperAccount(trades, prefs.paperBankrollEur || 1000),
      storage: storageInfo(),
      fetchedAt: Date.now(),
    });
  }
}

/** Restaure le paper depuis le navigateur si /tmp Vercel a été vidé. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { trades?: PaperTrade[] };
    const incoming = Array.isArray(body.trades) ? body.trades : [];
    const merged = await mergePaperTrades(incoming.slice(0, 80));
    const prefs = await loadPrefs();
    return Response.json({
      trades: merged.slice(0, 40),
      account: computePaperAccount(merged, prefs.paperBankrollEur || 1000),
      storage: storageInfo(),
      fetchedAt: Date.now(),
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Merge paper impossible" },
      { status: 400 },
    );
  }
}
