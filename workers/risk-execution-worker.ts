/**
 * Risk + execution worker (scaffold).
 * Seul composant futur autorisé à appeler placeBoriazLiveTrade.
 * En shadow/paper : log TradeIntent sans ordre HL.
 */
import { runWorkerLoop } from "./_loop";
import {
  assertLiveEntryAllowed,
  getEnvRuntimeGate,
} from "../src/lib/bot/trading-mode";
import { reconcileLiveState } from "../src/lib/bot/reconciliation";

let reconciledOnce = false;

async function tick() {
  const gate = getEnvRuntimeGate();
  if (!reconciledOnce && gate.tradingMode === "live") {
    const report = await reconcileLiveState();
    reconciledOnce = true;
    return { status: "reconciled", report };
  }
  const live = await assertLiveEntryAllowed();
  return {
    status: live.allowed ? "armed" : "blocked",
    mode: gate.tradingMode,
    reasons: live.reasons,
    note: "Aucun ordre automatique dans ce scaffold",
  };
}

void runWorkerLoop({
  name: process.env.WORKER_NAME || "risk-execution-worker",
  intervalMs: Number(process.env.RISK_WORKER_INTERVAL_MS || 20_000),
  onTick: tick,
});
