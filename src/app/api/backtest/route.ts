import { runSimpleBacktest } from "@/lib/backtest";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const days = Number(url.searchParams.get("days") || 60);
    const coinsParam = url.searchParams.get("coins");
    const coins = coinsParam
      ? coinsParam.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean)
      : undefined;
    const payload = await runSimpleBacktest({
      days: Math.min(90, Math.max(30, days)),
      coins,
    });
    return Response.json(payload);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Backtest impossible" },
      { status: 502 },
    );
  }
}
