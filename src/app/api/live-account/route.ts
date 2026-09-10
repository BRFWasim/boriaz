import {
  fetchLiveExchangeTpslMap,
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
import { loadLiveManageSnapshots } from "@/lib/manage-live-positions";
import {
  botLabelFromPortfolio,
  tradeOutcomesUsd,
} from "@/lib/trade-outcomes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Portefeuille RÉEL Hyperliquid — séparé du paper.
 * Enrichit chaque position avec bot + TP/SL (journal, sinon ordres HL, sinon paper Boriaz).
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
  const manageSnaps = await loadLiveManageSnapshots();
  const exchangeTpsl = portfolio.ok ? await fetchLiveExchangeTpslMap() : {};

  if (portfolio.ok) {
    openJournal = await syncLiveJournalWithPositions(
      portfolio.positions.map((p) => ({ coin: p.coin, side: p.side })),
    );
    positions = portfolio.positions.map((p) => {
      const j = matchJournalToPosition(openJournal, p.coin, p.side);
      const snapKey = `${p.coin.toUpperCase()}:${p.side}`;
      const manageSnapshot =
        j?.manageSnapshot ?? manageSnaps[snapKey] ?? null;
      const ex = exchangeTpsl[p.coin.toUpperCase()];
      const exchangeTp = ex?.tp ?? null;
      const exchangeSl = ex?.sl ?? null;
      const nakedTpsl = !(exchangeTp != null && exchangeSl != null);

      // Fallback paper : UNIQUEMENT Boriaz/SMC (évite faux label « Défaut »)
      const paper = !j
        ? paperOpen.find(
            (t) =>
              t.coin.toUpperCase() === p.coin.toUpperCase() &&
              t.side === p.side &&
              (t.portfolioId === "boriaz" || t.strategy === "smc"),
          )
        : null;

      if (!j && !paper) {
        const outcomes =
          exchangeTp != null &&
          exchangeSl != null &&
          p.entryPx > 0 &&
          p.size > 0
            ? tradeOutcomesUsd({
                side: p.side,
                entry: p.entryPx,
                tp: exchangeTp,
                sl: exchangeSl,
                size: p.size,
              })
            : null;
        return {
          ...p,
          botLabel: nakedTpsl ? "Externe" : "HL (hors bot)",
          portfolioId: null,
          portfolioName: null,
          strategy: null,
          tp: exchangeTp,
          sl: exchangeSl,
          tpPnlUsd: outcomes?.tpPnlUsd ?? null,
          slPnlUsd: outcomes?.slPnlUsd ?? null,
          riskUsd: null,
          paperId: null,
          exchangeTp,
          exchangeSl,
          nakedTpsl,
          tpslSource: exchangeTp != null || exchangeSl != null ? "exchange" : "none",
          manageSnapshot,
        };
      }

      if (j) {
        const tp =
          exchangeTp != null && exchangeTp > 0
            ? exchangeTp
            : j.tp > 0
              ? j.tp
              : null;
        const sl =
          exchangeSl != null && exchangeSl > 0
            ? exchangeSl
            : j.sl > 0
              ? j.sl
              : null;
        const outcomes =
          tp != null && sl != null && p.size > 0
            ? tradeOutcomesUsd({
                side: p.side,
                entry: j.entry > 0 ? j.entry : p.entryPx,
                tp,
                sl,
                size: p.size,
              })
            : null;
        return {
          ...p,
          botLabel: j.botLabel || j.portfolioName || "Boriaz",
          portfolioId: j.portfolioId,
          portfolioName: j.portfolioName,
          strategy: j.strategy,
          tp,
          sl,
          tpPnlUsd: outcomes?.tpPnlUsd ?? j.tpPnlUsd ?? null,
          slPnlUsd: outcomes?.slPnlUsd ?? j.slPnlUsd ?? null,
          riskUsd: j.riskUsd,
          paperId: j.paperId ?? null,
          exchangeTp,
          exchangeSl,
          nakedTpsl,
          tpslSource:
            exchangeTp != null || exchangeSl != null
              ? "exchange"
              : tp != null || sl != null
                ? "journal"
                : "none",
          manageSnapshot,
        };
      }

      const entry = paper!.entry;
      const tpPaper = paper!.tp1Hit && paper!.tp2 ? paper!.tp2 : paper!.tp;
      const slPaper = paper!.tp1Hit ? paper!.entry : paper!.sl;
      const tp =
        exchangeTp != null && exchangeTp > 0 ? exchangeTp : tpPaper;
      const sl =
        exchangeSl != null && exchangeSl > 0 ? exchangeSl : slPaper;
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
        exchangeTp,
        exchangeSl,
        nakedTpsl,
        tpslSource:
          exchangeTp != null || exchangeSl != null
            ? "exchange"
            : "paper",
        manageSnapshot: manageSnapshot ?? paper!.manageSnapshot ?? null,
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
            "LIVE = Boriaz uniquement. TP/SL lus sur HL (ordres trigger) + journal. Positions hors bot = « Externe ».",
        }
      : null,
  });
}
