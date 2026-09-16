import { bindUserRequest } from "@/lib/bind-request";
import {
  forceReplaceLiveTpsl,
  isLiveEnvReady,
  repairNakedLiveTpsl,
} from "@/lib/hl-live";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/live-repair
 * - sans body : re-place TP/SL manquants (toutes positions nues)
 * - { coin, side?, forceReplace?: true, tp?, sl? } : force cancel+replace sur une position
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
      forceReplace?: boolean;
      tp?: number;
      sl?: number;
    } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      /* no body = repair global */
    }

    const coin = String(body.coin || "").trim();
    if (coin && (body.forceReplace === true || body.tp || body.sl)) {
      const result = await forceReplaceLiveTpsl({
        coin,
        side: body.side,
        tp: body.tp,
        sl: body.sl,
      });
      if (!result.ok) {
        return Response.json(
          { error: result.reason || "Replace échoué", ...result },
          { status: 400 },
        );
      }
      return Response.json({
        mode: "force-replace",
        ...result,
        ok: true,
        fetchedAt: Date.now(),
      });
    }

    const result = await repairNakedLiveTpsl();
    return Response.json({
      ok: true,
      mode: "naked",
      ...result,
      fetchedAt: Date.now(),
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Repair impossible" },
      { status: 400 },
    );
  }
}
