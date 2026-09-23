import { after } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: Request): { ok: boolean; error?: string } {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return {
      ok: false,
      error: "CRON_SECRET manquant — cron/zone refusé (fail-closed)",
    };
  }
  const header = request.headers.get("authorization") || "";
  const url = new URL(request.url);
  const q = url.searchParams.get("secret");
  if (header === `Bearer ${secret}` || q === secret) return { ok: true };
  return { ok: false, error: "Unauthorized" };
}

/**
 * Poll rapide zones armées (mid ∈ ÔTE) → force scan.
 * Burst WebSocket allMids (hl-mids) + fallback HTTP — pas de worker WS permanent.
 */
export async function GET(request: Request) {
  const auth = authorized(request);
  if (!auth.ok) {
    return Response.json(
      { error: auth.error || "Unauthorized" },
      { status: auth.error?.includes("CRON_SECRET") ? 503 : 401 },
    );
  }

  const startedAt = Date.now();
  after(async () => {
    try {
      const { checkArmedZonesAndScan } = await import("@/lib/zone-watch");
      const { cleanupStaleLiveLimits } = await import("@/lib/live-cleanup");
      const {
        detectStopOutsAndArmCooldown,
        widenTightLiveStops,
      } = await import("@/lib/live-protect");
      const zone = await checkArmedZonesAndScan();
      const cleanup = await cleanupStaleLiveLimits();
      const stopOuts = await detectStopOutsAndArmCooldown();
      const widen = await widenTightLiveStops();
      console.info("cron/zone after done", {
        ms: Date.now() - startedAt,
        zone,
        cleanupCancelled: cleanup.cancelled,
        stopOuts,
        widen,
      });
    } catch (e) {
      console.error("cron/zone after failed", e);
    }
  });

  return Response.json({
    ok: true,
    accepted: true,
    phase: "zone",
    mode: "ack-after",
    at: startedAt,
  });
}
