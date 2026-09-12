/**
 * Modes trading + kill switch.
 * Défaut sûr : shadow, LIVE_TRADING_ENABLED=false, GLOBAL_KILL_SWITCH=true.
 * Ne jamais passer en live depuis le client seul.
 */

import { pgQuery, databaseUrlConfigured, postgresHealth } from "@/lib/db/client";
import {
  cacheGet,
  cacheSet,
  redisDurableForLive,
  redisHealth,
  getRedisBackend,
} from "@/lib/redis/client";

export type TradingMode = "shadow" | "paper" | "live";

export type RuntimeGate = {
  tradingMode: TradingMode;
  liveTradingEnabled: boolean;
  globalKillSwitch: boolean;
  reconciliationRequired: boolean;
  source: "env" | "postgres" | "redis-cache" | "default";
};

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  if (v == null || v === "") return fallback;
  return v === "true" || v === "1" || v === "yes";
}

function envMode(): TradingMode {
  const v = (process.env.TRADING_MODE || "shadow").trim().toLowerCase();
  if (v === "live" || v === "paper" || v === "shadow") return v;
  return "shadow";
}

/** Lecture env seule (sans I/O) — utilisée au boot et fallback. */
export function getEnvRuntimeGate(): RuntimeGate {
  return {
    tradingMode: envMode(),
    liveTradingEnabled: envBool("LIVE_TRADING_ENABLED", false),
    // Défaut TRUE = sûr (bloque live). Mettre false explicitement pour paper/live.
    globalKillSwitch: envBool("GLOBAL_KILL_SWITCH", true),
    reconciliationRequired: envBool("RECONCILIATION_REQUIRED", true),
    source: "env",
  };
}

export async function getRuntimeGate(): Promise<RuntimeGate> {
  // Redis cache (TTL court)
  try {
    const cached = await cacheGet("bot:runtime_gate");
    if (cached) {
      const j = JSON.parse(cached) as RuntimeGate;
      if (j?.tradingMode) return { ...j, source: "redis-cache" };
    }
  } catch {
    /* ignore */
  }

  // Postgres source of truth si dispo
  if (databaseUrlConfigured()) {
    try {
      const res = await pgQuery<{
        trading_mode: TradingMode;
        live_trading_enabled: boolean;
        global_kill_switch: boolean;
        reconciliation_required: boolean;
      }>(
        `SELECT trading_mode, live_trading_enabled, global_kill_switch, reconciliation_required
         FROM bot_runtime_config WHERE id = 'global' LIMIT 1`,
      );
      const row = res?.rows?.[0];
      if (row) {
        const gate: RuntimeGate = {
          tradingMode: row.trading_mode,
          liveTradingEnabled: Boolean(row.live_trading_enabled),
          globalKillSwitch: Boolean(row.global_kill_switch),
          reconciliationRequired: Boolean(row.reconciliation_required),
          source: "postgres",
        };
        // Env peut forcer un kill switch plus strict
        const env = getEnvRuntimeGate();
        if (env.globalKillSwitch) gate.globalKillSwitch = true;
        if (env.tradingMode !== "live") {
          // Env shadow/paper empêche d’être live même si PG dit live
          if (env.tradingMode === "shadow" || env.tradingMode === "paper") {
            gate.tradingMode = env.tradingMode;
          }
        }
        if (!env.liveTradingEnabled) gate.liveTradingEnabled = false;
        await cacheSet("bot:runtime_gate", JSON.stringify(gate), 15).catch(
          () => undefined,
        );
        return gate;
      }
    } catch {
      /* table absente → env */
    }
  }

  return getEnvRuntimeGate();
}

export type LiveEntryDecision = {
  allowed: boolean;
  mode: TradingMode;
  reasons: string[];
  warnings: string[];
};

/**
 * Autorité pour toute NOUVELLE entrée HL réelle.
 * Shadow/paper → jamais d’ordre réel.
 */
export async function assertLiveEntryAllowed(): Promise<LiveEntryDecision> {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const gate = await getRuntimeGate();

  if (gate.globalKillSwitch) {
    reasons.push("GLOBAL_KILL_SWITCH=true");
  }
  if (gate.tradingMode !== "live") {
    reasons.push(`TRADING_MODE=${gate.tradingMode} (live requis)`);
  }
  if (!gate.liveTradingEnabled) {
    reasons.push("LIVE_TRADING_ENABLED=false");
  }
  // Compat : HL_LIVE_ENABLED historique
  if (process.env.HL_LIVE_ENABLED?.trim().toLowerCase() !== "true") {
    reasons.push("HL_LIVE_ENABLED≠true");
  }

  if (gate.reconciliationRequired) {
    reasons.push("reconciliation_required=true — réconcilier avant live");
  }

  if (!redisDurableForLive()) {
    reasons.push(
      `Redis non durable (backend=${getRedisBackend()}) — LIVE bloqué`,
    );
  } else {
    const rh = await redisHealth();
    if (!rh.ok) reasons.push(`Redis unhealthy: ${rh.error || "error"}`);
  }

  const requirePg =
    process.env.POSTGRES_REQUIRED_FOR_LIVE?.trim().toLowerCase() !== "false";
  if (requirePg) {
    if (!databaseUrlConfigured()) {
      reasons.push("DATABASE_URL absent (POSTGRES_REQUIRED_FOR_LIVE)");
    } else {
      const ph = await postgresHealth();
      if (!ph.ok) reasons.push(`PostgreSQL unhealthy: ${ph.error || "error"}`);
    }
  }

  const network = (process.env.HYPERLIQUID_NETWORK || "").trim().toLowerCase();
  const testnet =
    process.env.HL_LIVE_TESTNET?.trim().toLowerCase() === "true" ||
    network === "testnet";
  const allowTestnetLive =
    process.env.ALLOW_TESTNET_LIVE?.trim().toLowerCase() === "true";
  if (testnet && !allowTestnetLive) {
    reasons.push("testnet live refusé (ALLOW_TESTNET_LIVE≠true)");
  }

  return {
    allowed: reasons.length === 0,
    mode: gate.tradingMode,
    reasons,
    warnings,
  };
}

/** Shadow ou paper : on peut simuler / logger sans HL. */
export function isSimulatedMode(mode: TradingMode): boolean {
  return mode === "shadow" || mode === "paper";
}

export async function writeConfigAudit(input: {
  actor: string;
  action: string;
  previous: unknown;
  next: unknown;
  reason?: string;
  correlationId?: string;
}): Promise<void> {
  if (!databaseUrlConfigured()) return;
  try {
    await pgQuery(
      `INSERT INTO configuration_audit_log
        (actor_identifier, action, previous_value_json, new_value_json, reason, correlation_id)
       VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6)`,
      [
        input.actor,
        input.action,
        JSON.stringify(input.previous ?? null),
        JSON.stringify(input.next ?? null),
        input.reason ?? null,
        input.correlationId ?? null,
      ],
    );
  } catch {
    /* migrations absentes */
  }
}

export async function updateRuntimeConfig(input: {
  actor: string;
  tradingMode?: TradingMode;
  liveTradingEnabled?: boolean;
  globalKillSwitch?: boolean;
  reconciliationRequired?: boolean;
  reason?: string;
}): Promise<RuntimeGate> {
  const prev = await getRuntimeGate();
  const next: RuntimeGate = {
    ...prev,
    tradingMode: input.tradingMode ?? prev.tradingMode,
    liveTradingEnabled: input.liveTradingEnabled ?? prev.liveTradingEnabled,
    globalKillSwitch: input.globalKillSwitch ?? prev.globalKillSwitch,
    reconciliationRequired:
      input.reconciliationRequired ?? prev.reconciliationRequired,
    source: "postgres",
  };

  // Garde-fou : passage live exige liveTradingEnabled
  if (next.tradingMode === "live" && !next.liveTradingEnabled) {
    throw new Error("TRADING_MODE=live exige LIVE_TRADING_ENABLED=true");
  }

  if (databaseUrlConfigured()) {
    await pgQuery(
      `INSERT INTO bot_runtime_config
         (id, trading_mode, live_trading_enabled, global_kill_switch, reconciliation_required, updated_at, updated_by)
       VALUES ('global',$1,$2,$3,$4,NOW(),$5)
       ON CONFLICT (id) DO UPDATE SET
         trading_mode = EXCLUDED.trading_mode,
         live_trading_enabled = EXCLUDED.live_trading_enabled,
         global_kill_switch = EXCLUDED.global_kill_switch,
         reconciliation_required = EXCLUDED.reconciliation_required,
         updated_at = NOW(),
         updated_by = EXCLUDED.updated_by`,
      [
        next.tradingMode,
        next.liveTradingEnabled,
        next.globalKillSwitch,
        next.reconciliationRequired,
        input.actor,
      ],
    );
  }

  await writeConfigAudit({
    actor: input.actor,
    action: "update_runtime_config",
    previous: prev,
    next,
    reason: input.reason,
  });

  await cacheSet("bot:runtime_gate", JSON.stringify(next), 15);
  await cacheSet("bot:kill_switch", String(next.globalKillSwitch), 60);
  await cacheSet("bot:trading_mode", next.tradingMode, 60);

  return next;
}
