import { DEFAULT_PREFS, loadPrefs, savePrefs } from "@/lib/persist";
import { bindUserRequest } from "@/lib/bind-request";

export const dynamic = "force-dynamic";

export async function GET() {
  await bindUserRequest();
  const prefs = await loadPrefs();
  return Response.json({ prefs, defaults: DEFAULT_PREFS });
}

export async function POST(request: Request) {
  try {
    await bindUserRequest();
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
    if (typeof body.paperBankrollEur === "number") {
      patch.paperBankrollEur = Math.min(100000, Math.max(100, body.paperBankrollEur));
    }
    if (typeof body.maxSafetyMode === "boolean") {
      patch.maxSafetyMode = body.maxSafetyMode;
    }
    if (typeof body.customTradingMode === "boolean") {
      patch.customTradingMode = body.customTradingMode;
    }
    if (typeof body.customMinRR === "number") {
      patch.customMinRR = Math.max(0.5, Math.min(10, body.customMinRR));
    }
    if (typeof body.customTargetEur === "number") {
      patch.customTargetEur = Math.max(10, body.customTargetEur);
    }
    if (typeof body.customMaxLossEur === "number") {
      patch.customMaxLossEur = Math.max(10, body.customMaxLossEur);
    }
    if (typeof body.customTradesPerDay === "number") {
      patch.customTradesPerDay = Math.max(0, Math.min(50, Math.floor(body.customTradesPerDay)));
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
