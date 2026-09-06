import {
  fetchLivePortfolio,
  getLiveConfig,
  isLiveEnvReady,
} from "@/lib/hl-live";
import { bindUserRequest } from "@/lib/bind-request";
import { loadPaperTrades, loadPrefs } from "@/lib/persist";
import {
  loadLiveJournal,
  matchJournalToPosition,
  syncLiveJournalWithPositions,
} from "@/lib/live-journal";
import {
  botLabelFromPortfolio,
  tradeOutcomesUsd,
} from "@/lib/trade-outcomes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Portefeuille RÉEL Hyperliquid — séparé du paper.
 * Enrichit chaque position avec le bot (Boriaz / Scalp / Défaut) + si TP / si SL.
 * Jamais de private key dans la réponse.
 */
export async function GET() {
  await bindUserRequest();
  const cfg = getLiveConfig();
  const ready = isLiveEnvReady();
  const prefs = await loadPrefs();
  const boriaz = prefs.portfolios.find((p) => p.id === "boriaz");
  const defaultPf = prefs.portfolios.find((p) => p.id === "default");
  const portfolio = await fetchLivePortfolio();
  const paperOpen = (await loadPaperTrades()).filter(
    (t) => t.status === "open" || t.status === "pending",
  );

  let positions = portfolio.positions;
  let openJournal = await loadLiveJournal().then((all) =>
    all.filter((e) => e.status === "open"),
  );

  if (portfolio.ok) {
    openJournal = await syncLiveJournalWithPositions(
      portfolio.positions.map((p) => ({ coin: p.coin, side: p.side })),
    );
    positions = portfolio.positions.map((p) => {
      const j = matchJournalToPosition(openJournal, p.coin, p.side);
      // Fallback paper (même coin+side) si journal manquant — bot / Si TP-SL
      const paper = !j
        ? paperOpen.find(
            (t) =>
              t.coin.toUpperCase() === p.coin.toUpperCase() &&
              t.side === p.side,
          )
        : null;

      if (!j && !paper) {
        return {
          ...p,
          botLabel: null,
          portfolioId: null,
          portfolioName: null,
          strategy: null,
          tp: null,
          sl: null,
          tpPnlUsd: null,
          slPnlUsd: null,
          riskUsd: null,
          paperId: null,
        };
      }

      if (j) {
        const outcomes =
          j.tp > 0 && j.sl > 0 && p.size > 0
            ? tradeOutcomesUsd({
                side: p.side,
                entry: j.entry > 0 ? j.entry : p.entryPx,
                tp: j.tp,
                sl: j.sl,
                size: p.size,
              })
            : null;
        return {
          ...p,
          botLabel: j.botLabel || j.portfolioName || null,
          portfolioId: j.portfolioId,
          portfolioName: j.portfolioName,
          strategy: j.strategy,
          tp: j.tp,
          sl: j.sl,
          tpPnlUsd: outcomes?.tpPnlUsd ?? j.tpPnlUsd ?? null,
          slPnlUsd: outcomes?.slPnlUsd ?? j.slPnlUsd ?? null,
          riskUsd: j.riskUsd,
          paperId: j.paperId ?? null,
        };
      }

      const entry = paper!.entry;
      const tp = paper!.tp1Hit && paper!.tp2 ? paper!.tp2 : paper!.tp;
      const sl = paper!.tp1Hit ? paper!.entry : paper!.sl;
      const outcomes = tradeOutcomesUsd({
        side: p.side,
        entry,
        tp,
        sl,
        size: p.size,
      });
      return {
        ...p,
        botLabel: botLabelFromPortfolio({
          portfolioId: paper!.portfolioId,
          portfolioName: paper!.portfolioName,
          strategy: paper!.strategy,
        }),
        portfolioId: paper!.portfolioId ?? null,
        portfolioName: paper!.portfolioName ?? null,
        strategy: paper!.strategy ?? null,
        tp,
        sl,
        tpPnlUsd: outcomes.tpPnlUsd,
        slPnlUsd: outcomes.slPnlUsd,
        riskUsd: null,
        paperId: paper!.id,
      };
    });
  }

  return Response.json({
    ok: true,
    env: {
      armed: cfg.envArmed,
      hasAgentKey: cfg.hasAgentKey,
      ready: ready.ok,
      reason: ready.reason ?? null,
      testnet: cfg.testnet,
      maxNotionalUsd: cfg.maxNotionalUsd,
      maxLeverage: cfg.maxLeverage,
      maxOpenPositions: cfg.maxOpenPositions,
      agentAddress: cfg.agentAddress,
      accountAddress: cfg.accountAddress,
    },
    prefs: {
      liveTradeEnabled: Boolean(prefs.liveTradeEnabled),
      boriazLiveTradeEnabled: Boolean(boriaz?.liveTradeEnabled),
      defaultLiveTradeEnabled: Boolean(defaultPf?.liveTradeEnabled),
    },
    portfolio: {
      ...portfolio,
      positions,
    },
    openJournal,
    riskPreview: portfolio.ok
      ? {
          riskPct: 2,
          riskUsd: Math.round(portfolio.accountValueUsd * 0.02 * 100) / 100,
          note:
            "Boriaz live = même % de marge que le paper sur l’equity HL. Si TP / Si SL / bot via journal partagé.",
        }
      : null,
  });
}
