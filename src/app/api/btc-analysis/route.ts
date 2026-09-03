import { getBtcAnalysis } from "@/lib/btc-analysis";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const payload = await getBtcAnalysis();
    return Response.json(payload);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Analyse BTC indisponible.";
    return Response.json({ error: message }, { status: 502 });
  }
}
