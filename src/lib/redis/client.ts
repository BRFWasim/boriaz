/**
 * Redis : cache temps réel, locks, heartbeats, rate limits.
 * Ne remplace JAMAIS PostgreSQL comme source de vérité.
 *
 * Backends :
 * - REDIS_URL → ioredis (Docker / VPS)
 * - UPSTASH_REDIS_REST_* → REST (existant Vercel)
 * - aucun → mémoire process (dev) — LIVE bloqué
 */

import Redis from "ioredis";
import { kvGet, kvSet, kvSetEx, kvBackend } from "@/lib/kv";

let redis: Redis | null = null;
let lastError: string | null = null;
const memTtl = new Map<string, { value: string; exp: number }>();

export type RedisBackend = "ioredis" | "upstash-rest" | "memory";

export function redisUrlConfigured(): boolean {
  return Boolean(process.env.REDIS_URL?.trim());
}

export function getRedisBackend(): RedisBackend {
  if (redisUrlConfigured()) return "ioredis";
  if (kvBackend() === "upstash") return "upstash-rest";
  return "memory";
}

function getIoredis(): Redis | null {
  if (!redisUrlConfigured()) return null;
  if (redis) return redis;
  redis = new Redis(process.env.REDIS_URL!.trim(), {
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    lazyConnect: true,
  });
  redis.on("error", (err) => {
    lastError = err.message;
  });
  return redis;
}

export async function redisHealth(): Promise<{
  ok: boolean;
  backend: RedisBackend;
  latencyMs: number | null;
  error: string | null;
}> {
  const backend = getRedisBackend();
  const t0 = Date.now();
  try {
    if (backend === "ioredis") {
      const r = getIoredis()!;
      if (r.status !== "ready") await r.connect().catch(() => undefined);
      const pong = await r.ping();
      return {
        ok: pong === "PONG",
        backend,
        latencyMs: Date.now() - t0,
        error: null,
      };
    }
    if (backend === "upstash-rest") {
      await kvSetEx("bot:healthcheck", String(Date.now()), 30);
      const v = await kvGet("bot:healthcheck");
      return {
        ok: Boolean(v),
        backend,
        latencyMs: Date.now() - t0,
        error: null,
      };
    }
    return {
      ok: true,
      backend,
      latencyMs: 0,
      error: "memory-only (LIVE bloqué)",
    };
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      backend,
      latencyMs: Date.now() - t0,
      error: lastError,
    };
  }
}

export async function cacheGet(key: string): Promise<string | null> {
  const backend = getRedisBackend();
  if (backend === "ioredis") {
    const r = getIoredis()!;
    if (r.status !== "ready") await r.connect().catch(() => undefined);
    return (await r.get(key)) ?? null;
  }
  if (backend === "upstash-rest") return kvGet(key);
  const hit = memTtl.get(key);
  if (!hit) return null;
  if (hit.exp < Date.now()) {
    memTtl.delete(key);
    return null;
  }
  return hit.value;
}

export async function cacheSet(
  key: string,
  value: string,
  ttlSec?: number,
): Promise<void> {
  const backend = getRedisBackend();
  if (backend === "ioredis") {
    const r = getIoredis()!;
    if (r.status !== "ready") await r.connect().catch(() => undefined);
    if (ttlSec && ttlSec > 0) await r.set(key, value, "EX", Math.floor(ttlSec));
    else await r.set(key, value);
    return;
  }
  if (backend === "upstash-rest") {
    if (ttlSec && ttlSec > 0) await kvSetEx(key, value, ttlSec);
    else await kvSet(key, value);
    return;
  }
  memTtl.set(key, {
    value,
    exp: ttlSec && ttlSec > 0 ? Date.now() + ttlSec * 1000 : Date.now() + 86400_000,
  });
}

/** Lock atomique SET NX EX. Retourne true si acquis. */
export async function acquireLock(
  key: string,
  ttlSec: number,
  token: string,
): Promise<boolean> {
  const backend = getRedisBackend();
  const ttl = Math.max(1, Math.floor(ttlSec));
  if (backend === "ioredis") {
    const r = getIoredis()!;
    if (r.status !== "ready") await r.connect().catch(() => undefined);
    const res = await r.set(key, token, "EX", ttl, "NX");
    return res === "OK";
  }
  // Upstash REST / memory : best-effort (pas parfaitement atomique via REST simple)
  const existing = await cacheGet(key);
  if (existing) return false;
  await cacheSet(key, token, ttl);
  return true;
}

export async function releaseLock(key: string, token: string): Promise<void> {
  const current = await cacheGet(key);
  if (current === token) {
    const backend = getRedisBackend();
    if (backend === "ioredis") {
      const r = getIoredis()!;
      await r.del(key);
      return;
    }
    await cacheSet(key, "", 1);
  }
}

export async function setWorkerHeartbeat(
  workerName: string,
  meta: Record<string, unknown> = {},
): Promise<void> {
  const payload = JSON.stringify({
    at: new Date().toISOString(),
    ...meta,
  });
  await cacheSet(`worker:${workerName}:heartbeat`, payload, 60);
  await cacheSet(`worker:${workerName}:status`, "running", 60);
}

export function getLastRedisError(): string | null {
  return lastError;
}

export async function closeRedis(): Promise<void> {
  if (!redis) return;
  await redis.quit().catch(() => redis?.disconnect());
  redis = null;
}

/** LIVE autorisé seulement si backend Redis durable (pas memory). */
export function redisDurableForLive(): boolean {
  const b = getRedisBackend();
  return b === "ioredis" || b === "upstash-rest";
}
