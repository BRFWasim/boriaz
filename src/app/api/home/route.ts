import { getHomeSnapshot } from "@/lib/home";
import { bindUserRequest } from "@/lib/bind-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Fast ~2s ; full soft-timeout 8s + marge. */
export const maxDuration = 30;

export async function GET(req: Request) {
  try {
    await bindUserRequest();
    const url = new URL(req.url);
    const fast =
      url.searchParams.get("fast") === "1" ||
      url.searchParams.get("fast") === "true";
    const payload = await getHomeSnapshot({ fast });
    return Response.json(payload);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Accueil indisponible";
    return Response.json({ error: message }, { status: 502 });
  }
}
