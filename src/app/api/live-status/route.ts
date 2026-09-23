import { getLiveConfig, isLiveEnvReady } from "@/lib/hl-live";
import { bindUserRequest } from "@/lib/bind-request";
import { loadPrefs } from "@/lib/persist";
import { liveSidesLabel } from "@/lib/live-side-policy";
import { isPrefsLiveArmed } from "@/lib/user-types";

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
  const togglesOn = isPrefsLiveArmed(prefs);

  return Response.json({
    ok: true,
    env: {
      armed: cfg.envArmed,
      hasAgentKey: cfg.hasAgentKey,
      ready: ready.ok,
      reason: ready.reason ?? null,
      testnet: cfg.testnet,
      allowShort: cfg.allowShort,
      sides: liveSidesLabel(),
      maxNotionalUsd: cfg.maxNotionalUsd,
      maxLeverage: cfg.maxLeverage,
      maxOpenPositions: cfg.maxOpenPositions,
      /** Adresse agent dérivée (publique) — pas la clé. */
      agentAddress: cfg.agentAddress,
      accountAddress: cfg.accountAddress,
    },
    prefs: {
      liveTradeEnabled: togglesOn,
      boriazLiveTradeEnabled: Boolean(boriaz?.liveTradeEnabled),
      armed: togglesOn,
    },
    howto: {
      keyWhere:
        "Vercel → Settings → Environment Variables → HL_AGENT_PRIVATE_KEY (Secret). Jamais en chat / Git / Lab.",
      agentWallet:
        "Sur app.hyperliquid.xyz → API → créer un Agent Wallet, coller UNIQUEMENT sa private key (pas la seed master).",
      arm:
        "HL_LIVE_ENABLED=true + Lab → portefeuille Boriaz → « LIVE HL » (un seul interrupteur).",
      sides:
        "HL_ALLOW_SHORT=true → shorts qualité (continuation D1+H4 deep, conf≥90). false → Long-only.",
      cron: "cron-job.org → /api/cron (ACK <2s, travail en fond). Manage trades d’abord, puis signaux/live. /api/cron/zone = burst WS mids.",
    },
  });
}
