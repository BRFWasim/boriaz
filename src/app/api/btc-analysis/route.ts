import { getBtcAnalysis } from "@/lib/btc-analysis";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const includeAi = url.searchParams.get("ai") === "1";
    const force = url.searchParams.get("force") === "1";
    const payload = await getBtcAnalysis({
      includeAi,
      force,
      notify: includeAi,
    });
    return Response.json(payload);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Analyse marché indisponible.";
    return Response.json({ error: message }, { status: 502 });
  }
}
