import { getLiveConfig, isLiveEnvReady } from "@/lib/hl-live";
import { bindUserRequest } from "@/lib/bind-request";
import { loadPrefs } from "@/lib/persist";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Statut LIVE Hyperliquid (Boriaz) — jamais de private key dans la réponse.
 */
export async function GET() {
  await bindUserRequest();
  const cfg = getLiveConfig();
  const ready = isLiveEnvReady();
  const prefs = await loadPrefs();
  const boriaz = prefs.portfolios.find((p) => p.id === "boriaz");

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
      /** Adresse agent dérivée (publique) — pas la clé. */
      agentAddress: cfg.agentAddress,
      accountAddress: cfg.accountAddress,
    },
    prefs: {
      liveTradeEnabled: Boolean(prefs.liveTradeEnabled),
      boriazLiveTradeEnabled: Boolean(boriaz?.liveTradeEnabled),
    },
    howto: {
      keyWhere:
        "Vercel → Settings → Environment Variables → HL_AGENT_PRIVATE_KEY (Secret). Jamais en chat / Git / Lab.",
      agentWallet:
        "Sur app.hyperliquid.xyz → API → créer un Agent Wallet, coller UNIQUEMENT sa private key (pas la seed master).",
      arm:
        "Mettre HL_LIVE_ENABLED=true + caps HL_MAX_* puis activer les 2 toggles Lab (global + Boriaz).",
      cron: "Le cron /api/cron (~15 min) lance getTradeSignals → SMC Boriaz → éventuel ordre live.",
    },
  });
}
