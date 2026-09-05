import { getHomeSnapshot } from "@/lib/home";
import { bindUserRequest } from "@/lib/bind-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Soft-timeout dans getHomeSnapshot (~12s) + marge. */
export const maxDuration = 60;

export async function GET() {
  try {
    await bindUserRequest();
    const payload = await getHomeSnapshot();
    return Response.json(payload);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Accueil indisponible";
    return Response.json({ error: message }, { status: 502 });
  }
}
