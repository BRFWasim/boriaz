import { postgresHealth, databaseUrlConfigured } from "@/lib/db/client";
import { redisHealth, getRedisBackend } from "@/lib/redis/client";
import { getEnvRuntimeGate } from "@/lib/bot/trading-mode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/bot/health — healthcheck léger (Docker / probes).
 * Pas d’auth (liveness). Ne révèle pas de secrets.
 */
export async function GET() {
  const gate = getEnvRuntimeGate();
  const pg = await postgresHealth();
  const redis = await redisHealth();
  const ok =
    (gate.tradingMode !== "live" || (pg.ok && redis.ok)) &&
    (gate.tradingMode === "shadow" || gate.tradingMode === "paper" || pg.ok);

  return Response.json(
    {
      ok: gate.tradingMode === "shadow" ? true : ok,
      tradingMode: gate.tradingMode,
      killSwitch: gate.globalKillSwitch,
      postgres: { configured: databaseUrlConfigured(), ok: pg.ok },
      redis: { backend: getRedisBackend(), ok: redis.ok },
      at: new Date().toISOString(),
    },
    { status: 200 },
  );
}
