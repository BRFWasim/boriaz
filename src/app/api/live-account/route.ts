import { fetchLivePortfolio, getLiveConfig, isLiveEnvReady } from "@/lib/hl-live";
import { bindUserRequest } from "@/lib/bind-request";
import { loadPrefs } from "@/lib/persist";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Portefeuille RÉEL Hyperliquid — séparé du paper.
 * Jamais de private key dans la réponse.
 */
export async function GET() {
  await bindUserRequest();
  const cfg = getLiveConfig();
  const ready = isLiveEnvReady();
  const prefs = await loadPrefs();
  const boriaz = prefs.portfolios.find((p) => p.id === "boriaz");
  const portfolio = await fetchLivePortfolio();

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
    },
    portfolio,
    riskPreview: portfolio.ok
      ? {
          riskPct: 2,
          riskUsd: Math.round(portfolio.accountValueUsd * 0.02 * 100) / 100,
          note: "Live Boriaz = 2% de l’equity HL réelle (paper ignoré).",
        }
      : null,
  });
}
