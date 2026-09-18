import { bindUserRequest } from "@/lib/bind-request";
import { getBotStatus } from "@/lib/bot/status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/bot/status — mode, kill switch, PG/Redis, workers (pas de secrets). */
export async function GET() {
  try {
    await bindUserRequest();
    const status = await getBotStatus();
    return Response.json(status);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "status error" },
      { status: 400 },
    );
  }
}
