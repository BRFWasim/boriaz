import { getTradeSignals } from "@/lib/trade-signal";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const notify = url.searchParams.get("notify") === "1";
    const force = url.searchParams.get("force") === "1";
    const { bindUserRequest } = await import("@/lib/bind-request");
    await bindUserRequest();
    const payload = await getTradeSignals({ notify, force });
    return Response.json(payload);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Signaux indisponibles";
    return Response.json({ error: message }, { status: 502 });
  }
}
