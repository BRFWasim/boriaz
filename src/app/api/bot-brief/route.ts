import { getBotBrief } from "@/lib/bot-brief";
import { bindUserRequest } from "@/lib/bind-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

/** Santé paper/LIVE + petites notifs d’analyse (prévu / attendre). */
export async function GET() {
  try {
    await bindUserRequest({ follow: false });
    const payload = await getBotBrief();
    return Response.json(payload);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Brief indisponible";
    return Response.json({ error: message }, { status: 502 });
  }
}
