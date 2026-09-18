/**
 * Market data worker (scaffold H24).
 * Phase actuelle : heartbeat + fraîcheur mids HTTP (WS Hyperliquid à brancher).
 * N’envoie JAMAIS d’ordre. N’appelle JAMAIS l’IA.
 */
import { runWorkerLoop } from "./_loop";
import { cacheSet } from "../src/lib/redis/client";
import { postInfo } from "../src/lib/hyperliquid";

async function tick() {
  const staleSec = Number(process.env.MARKET_DATA_STALE_SECONDS || 10);
  const t0 = Date.now();
  try {
    const mids = (await postInfo({ type: "allMids" })) as Record<string, string>;
    const btc = mids?.BTC || mids?.btc || null;
    await cacheSet(
      "market:BTC:latest",
      JSON.stringify({ price: btc, at: new Date().toISOString() }),
      Math.max(staleSec * 3, 30),
    );
    await cacheSet("market:BTC:last_update", new Date().toISOString(), 120);
    return {
      status: "ok",
      transport: "http-poll",
      btc,
      latencyMs: Date.now() - t0,
      note: "WS Hyperliquid SubscriptionClient à brancher (phase 5)",
    };
  } catch (e) {
    return {
      status: "degraded",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

void runWorkerLoop({
  name: process.env.WORKER_NAME || "market-data-worker",
  intervalMs: Number(process.env.MARKET_WORKER_INTERVAL_MS || 10_000),
  onTick: tick,
});
