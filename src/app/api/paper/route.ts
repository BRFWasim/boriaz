import {
  aggregatePaperAccount,
  closePaperTrade,
  computePaperAccount,
  ensurePortfolios,
  loadPaperTrades,
  loadPrefs,
  mergePaperTrades,
  savePaperTrades,
  storageInfo,
} from "@/lib/persist";
import { getTradeSignals } from "@/lib/trade-signal";
import { postInfo } from "@/lib/hyperliquid";
import { parseNum } from "@/lib/format";
import { sendTelegramMessage } from "@/lib/telegram";
import type { PaperTrade } from "@/lib/user-types";
import { bindUserRequest } from "@/lib/bind-request";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    await bindUserRequest();
    // Pas de force:true ici — évite un timeout Vercel (504 texte non-JSON).
    // Le mark-to-market live est déjà fait par /api/live.
    const sig = await getTradeSignals({ notify: false });
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

/** Clôture manuelle d'un trade, ou restauration du paper depuis le navigateur. */
export async function POST(request: Request) {
  try {
    await bindUserRequest();
    const body = (await request.json()) as {
      action?: string;
      id?: string;
      trades?: PaperTrade[];
    };

    // Clôture manuelle immédiate au prix marché
    if (body.action === "close" && body.id) {
      const trades = await loadPaperTrades();
      const target = trades.find((t) => t.id === body.id);
      if (!target) {
        return Response.json({ error: "Trade introuvable" }, { status: 404 });
      }
      let px = target.markPx ?? target.entry;
      try {
        const mids = (await postInfo({ type: "allMids" })) as Record<
          string,
          string
        >;
        const live = parseNum(mids[target.coin] ?? "0");
        if (live > 0) px = live;
      } catch {
        /* garde le dernier mark connu */
      }
      const closed = await closePaperTrade(body.id, px, "Clôture manuelle");
      const prefs = await loadPrefs();
      if (closed && prefs.telegramEnabled) {
        const pnl = closed.pnlEur ?? 0;
        await sendTelegramMessage(
          [
            `✋ Clôture manuelle · ${closed.side.toUpperCase()} ${closed.coin}`,
            `Portefeuille « ${closed.portfolioName || "Défaut"} »`,
            `Entrée ${closed.entry} → sortie ${closed.exitPx ?? px}`,
            `PnL net ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} € (frais ${(closed.feesEur ?? 0).toFixed(2)} €)`,
            "Simulation paper — pas un conseil financier.",
          ].join("\n"),
        );
        // évite un doublon si un autre chemin repassait dessus
        const after = await loadPaperTrades();
        const t2 = after.find((t) => t.id === closed.id);
        if (t2) {
          t2.closeNotified = true;
          await savePaperTrades(after);
        }
      }
      const latest = await loadPaperTrades();
      return Response.json({
        ok: Boolean(closed),
        closed,
        trades: latest.slice(0, 40),
        account: aggregatePaperAccount(latest, ensurePortfolios(prefs.portfolios)),
        storage: storageInfo(),
        fetchedAt: Date.now(),
      });
    }

    const incoming = Array.isArray(body.trades) ? body.trades : [];
    const merged = await mergePaperTrades(incoming.slice(0, 80));
    const prefs = await loadPrefs();
    return Response.json({
      trades: merged.slice(0, 40),
      account: aggregatePaperAccount(merged, ensurePortfolios(prefs.portfolios)),
      storage: storageInfo(),
      fetchedAt: Date.now(),
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Action paper impossible" },
      { status: 400 },
    );
  }
}
