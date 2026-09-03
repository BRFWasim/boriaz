import { loadPaperTrades, computePaperAccount, loadPrefs } from "@/lib/persist";
import { getTradeSignals } from "@/lib/trade-signal";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const sig = await getTradeSignals({ notify: false, force: true });
    return Response.json({
      trades: sig.paper,
      account: sig.account,
      fetchedAt: Date.now(),
      howto:
        "Paper = compte virtuel 1000 €. On simule chaque signal comme si tu l’avais suivi. Equity = cash + positions ouvertes marquées au prix live.",
    });
  } catch {
    const [prefs, trades] = await Promise.all([loadPrefs(), loadPaperTrades()]);
    return Response.json({
      trades: trades.slice(0, 40),
      account: computePaperAccount(trades, prefs.paperBankrollEur || 1000),
      fetchedAt: Date.now(),
    });
  }
}
