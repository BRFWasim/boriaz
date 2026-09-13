import { bindUserRequest } from "@/lib/bind-request";
import { isLiveEnvReady, repairNakedLiveTpsl } from "@/lib/hl-live";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/live-repair
 * Re-place TP/SL manquants sur positions HL ouvertes (urgence SL 1.5% / TP 2R
 * si le journal n’a pas de niveaux).
 */
export async function POST() {
  try {
    await bindUserRequest();
    const ready = isLiveEnvReady();
    if (!ready.ok) {
      return Response.json(
        { error: ready.reason || "LIVE HL non prêt (env)" },
        { status: 400 },
      );
    }
    const result = await repairNakedLiveTpsl();
    return Response.json({
      ok: true,
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
