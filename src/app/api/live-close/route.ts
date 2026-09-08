import { bindUserRequest } from "@/lib/bind-request";
import { closeLivePosition, isLiveEnvReady } from "@/lib/hl-live";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/live-close
 * body: { coin: string, side?: "long"|"short", fraction?: number }
 * Clôture manuelle d’une position HL (market reduce-only).
 */
export async function POST(request: Request) {
  try {
    await bindUserRequest();
    const ready = isLiveEnvReady();
    if (!ready.ok) {
      return Response.json(
        { error: ready.reason || "LIVE HL non prêt (env)" },
        { status: 400 },
      );
    }

    let body: {
      coin?: string;
      side?: "long" | "short";
      fraction?: number;
    } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return Response.json({ error: "JSON requis" }, { status: 400 });
    }

    const coin = String(body.coin || "").trim();
    if (!coin) {
      return Response.json({ error: "coin requis" }, { status: 400 });
    }
    const side =
      body.side === "long" || body.side === "short" ? body.side : undefined;
    const fraction =
      body.fraction != null && Number.isFinite(Number(body.fraction))
        ? Number(body.fraction)
        : 1;

    const result = await closeLivePosition({ coin, side, fraction });
    if (!result.ok) {
      return Response.json(
        { error: result.reason || "Clôture impossible", ...result },
        { status: 400 },
      );
    }
    return Response.json({
      ...result,
      ok: true,
      fetchedAt: Date.now(),
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Clôture impossible" },
      { status: 400 },
    );
  }
}
