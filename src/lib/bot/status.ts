/**
 * Statut agrégé bot (dashboard / healthchecks).
 */

import { getRuntimeGate, assertLiveEntryAllowed } from "@/lib/bot/trading-mode";
import { postgresHealth, databaseUrlConfigured } from "@/lib/db/client";
import {
  redisHealth,
  getRedisBackend,
  cacheGet,
  redisDurableForLive,
} from "@/lib/redis/client";
import { getLiveConfig, isLiveEnvReady } from "@/lib/hl-live";

export async function getBotStatus() {
  const gate = await getRuntimeGate();
  const pg = await postgresHealth();
  const redis = await redisHealth();
  const liveEnv = isLiveEnvReady();
  const liveEntry = await assertLiveEntryAllowed();
  const liveCfg = getLiveConfig();
  const lastReconRaw = await cacheGet("bot:last_reconciliation");
  let lastReconciliation = null;
  try {
    lastReconciliation = lastReconRaw ? JSON.parse(lastReconRaw) : null;
  } catch {
    lastReconciliation = null;
  }

  const workers = [
    "market-data-worker",
    "strategy-worker",
    "ai-validation-worker",
    "risk-execution-worker",
    "scheduler-worker",
  ];
  const workerHeartbeats: Record<string, unknown> = {};
  for (const w of workers) {
    const hb = await cacheGet(`worker:${w}:heartbeat`);
    workerHeartbeats[w] = hb ? JSON.parse(hb) : null;
  }

  return {
    at: new Date().toISOString(),
    tradingMode: gate.tradingMode,
    liveTradingEnabled: gate.liveTradingEnabled,
    globalKillSwitch: gate.globalKillSwitch,
    reconciliationRequired: gate.reconciliationRequired,
    gateSource: gate.source,
    liveEntryAllowed: liveEntry.allowed,
    liveEntryReasons: liveEntry.reasons,
    liveEnvReady: liveEnv.ok,
    liveEnvReason: liveEnv.reason ?? null,
    hl: {
      envArmed: liveCfg.envArmed,
      testnet: liveCfg.testnet,
      hasAgentKey: liveCfg.hasAgentKey,
      accountConfigured: Boolean(liveCfg.accountAddress),
      // jamais de clés / adresses complètes sensibles au-delà de masquage
      accountAddress: liveCfg.accountAddress
        ? `${liveCfg.accountAddress.slice(0, 6)}…${liveCfg.accountAddress.slice(-4)}`
        : null,
    },
    postgres: {
      ...pg,
      configured: databaseUrlConfigured(),
    },
    redis: {
      ...redis,
      backend: getRedisBackend(),
      durableForLive: redisDurableForLive(),
    },
    lastReconciliation,
    workers: workerHeartbeats,
    defaults: {
      note: "Défaut post-migration = shadow + kill switch ON. Live jamais auto.",
    },
  };
}
