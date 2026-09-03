import { DEFAULT_PREFS, loadPrefs, savePrefs } from "@/lib/persist";

export const dynamic = "force-dynamic";

export async function GET() {
  const prefs = await loadPrefs();
  return Response.json({ prefs, defaults: DEFAULT_PREFS });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (typeof body.maxLeverage === "number") {
      patch.maxLeverage = Math.min(10, Math.max(1, body.maxLeverage));
    }
    if (Array.isArray(body.watchCoins)) {
      patch.watchCoins = body.watchCoins
        .map((c) => String(c).toUpperCase())
        .filter(Boolean)
        .slice(0, 20);
    }
    if (typeof body.hushHoursStart === "number") {
      patch.hushHoursStart = Math.min(23, Math.max(0, Math.floor(body.hushHoursStart)));
    }
    if (typeof body.hushHoursEnd === "number") {
      patch.hushHoursEnd = Math.min(23, Math.max(0, Math.floor(body.hushHoursEnd)));
    }
    if (typeof body.telegramEnabled === "boolean") {
      patch.telegramEnabled = body.telegramEnabled;
    }
    if (typeof body.paperTradeEnabled === "boolean") {
      patch.paperTradeEnabled = body.paperTradeEnabled;
    }
    const prefs = await savePrefs(patch);
    return Response.json({ prefs });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Prefs invalides" },
      { status: 400 },
    );
  }
}
