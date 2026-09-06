import {
  fetchLivePortfolio,
  getLiveConfig,
  isLiveEnvReady,
} from "@/lib/hl-live";
import { bindUserRequest } from "@/lib/bind-request";
import { loadPrefs } from "@/lib/persist";
import {
  loadLiveJournal,
  matchJournalToPosition,
  syncLiveJournalWithPositions,
} from "@/lib/live-journal";

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
      if (!j) {
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
      return {
        ...p,
        botLabel: j.botLabel,
        portfolioId: j.portfolioId,
        portfolioName: j.portfolioName,
        strategy: j.strategy,
        tp: j.tp,
        sl: j.sl,
        tpPnlUsd: j.tpPnlUsd,
        slPnlUsd: j.slPnlUsd,
        riskUsd: j.riskUsd,
        paperId: j.paperId ?? null,
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
          note: "Live = 2% de l’equity HL réelle (master). Paper ignoré.",
        }
      : null,
  });
}
