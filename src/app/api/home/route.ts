import { getHomeSnapshot } from "@/lib/home";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 90;

export async function GET() {
  try {
    const payload = await getHomeSnapshot();
    return Response.json(payload);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Accueil indisponible";
    return Response.json({ error: message }, { status: 502 });
  }
}
