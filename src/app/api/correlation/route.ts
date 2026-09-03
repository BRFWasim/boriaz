import { getMacroCorrelation } from "@/lib/correlation";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const payload = await getMacroCorrelation();
    return Response.json(payload);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Corrélation indisponible" },
      { status: 502 },
    );
  }
}
