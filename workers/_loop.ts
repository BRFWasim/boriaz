/**
 * Boucle worker générique : heartbeat Redis, SIGTERM propre, pas d’ordres.
 */

import { setWorkerHeartbeat, closeRedis } from "../src/lib/redis/client";
import { closePgPool } from "../src/lib/db/client";
import { getEnvRuntimeGate } from "../src/lib/bot/trading-mode";

export type WorkerLoopOptions = {
  name: string;
  intervalMs?: number;
  onTick: () => Promise<Record<string, unknown> | void>;
};

export async function runWorkerLoop(opts: WorkerLoopOptions): Promise<void> {
  const interval = opts.intervalMs ?? 15_000;
  let stopping = false;

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(
      JSON.stringify({
        service: opts.name,
        event: "shutdown",
        signal,
        at: new Date().toISOString(),
      }),
    );
    await closeRedis().catch(() => undefined);
    await closePgPool().catch(() => undefined);
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  const gate = getEnvRuntimeGate();
  console.log(
    JSON.stringify({
      service: opts.name,
      event: "start",
      tradingMode: gate.tradingMode,
      killSwitch: gate.globalKillSwitch,
      liveEnabled: gate.liveTradingEnabled,
      at: new Date().toISOString(),
    }),
  );

  while (!stopping) {
    try {
      const meta = (await opts.onTick()) || {};
      await setWorkerHeartbeat(opts.name, meta);
    } catch (e) {
      console.error(
        JSON.stringify({
          service: opts.name,
          event: "tick_error",
          message: e instanceof Error ? e.message : String(e),
        }),
      );
      await setWorkerHeartbeat(opts.name, {
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      }).catch(() => undefined);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}
