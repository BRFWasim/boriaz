/**
 * Scheduler — tâches lentes uniquement (rétention, métriques). Pas de trading.
 */
import { runWorkerLoop } from "./_loop";
import { pgQuery, databaseUrlConfigured } from "../src/lib/db/client";

async function runRetention(): Promise<Record<string, unknown>> {
  if (!databaseUrlConfigured()) return { retention: "skipped-no-pg" };
  const botDays = Number(process.env.BOT_EVENT_RETENTION_DAYS || 30);
  const marketDays = Number(process.env.MARKET_DATA_RETENTION_DAYS || 14);
  const deletedEvents = await pgQuery(
    `DELETE FROM bot_events WHERE created_at < NOW() - ($1::text || ' days')::interval
     AND id IN (SELECT id FROM bot_events WHERE created_at < NOW() - ($1::text || ' days')::interval LIMIT 5000)`,
    [String(botDays)],
  );
  const deletedSnaps = await pgQuery(
    `DELETE FROM market_snapshots WHERE created_at < NOW() - ($1::text || ' days')::interval
     AND id IN (SELECT id FROM market_snapshots WHERE created_at < NOW() - ($1::text || ' days')::interval LIMIT 5000)`,
    [String(marketDays)],
  );
  return {
    retention: "ok",
    botEventRetentionDays: botDays,
    marketRetentionDays: marketDays,
    deletedEvents: deletedEvents?.rowCount ?? 0,
    deletedSnaps: deletedSnaps?.rowCount ?? 0,
  };
}

let lastRetentionAt = 0;

async function tick() {
  const out: Record<string, unknown> = { status: "ok" };
  if (Date.now() - lastRetentionAt > 6 * 60 * 60_000) {
    out.retention = await runRetention();
    lastRetentionAt = Date.now();
  }
  return out;
}

void runWorkerLoop({
  name: process.env.WORKER_NAME || "scheduler-worker",
  intervalMs: Number(process.env.SCHEDULER_INTERVAL_MS || 60_000),
  onTick: tick,
});
