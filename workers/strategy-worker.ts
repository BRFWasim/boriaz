/**
 * Strategy worker (scaffold) — consommera stream:market_events.
 * Produit SignalCandidate (PG) sans IA ni exécution.
 */
import { runWorkerLoop } from "./_loop";
import { getEnvRuntimeGate } from "../src/lib/bot/trading-mode";

async function tick() {
  const gate = getEnvRuntimeGate();
  return {
    status: "idle",
    tradingMode: gate.tradingMode,
    note: "FeatureEngine + StrategyEngine à brancher (phases 6–7)",
  };
}

void runWorkerLoop({
  name: process.env.WORKER_NAME || "strategy-worker",
  intervalMs: Number(process.env.STRATEGY_WORKER_INTERVAL_MS || 15_000),
  onTick: tick,
});
