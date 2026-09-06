import {
  DEFAULT_PORTFOLIO,
  DEFAULT_PREFS,
  BORIAZ_PORTFOLIO,
  ensurePortfolios,
  loadPrefs,
  makeCustomPortfolio,
  savePrefs,
  type PortfolioProfile,
} from "@/lib/persist";
import { bindUserRequest } from "@/lib/bind-request";

export const dynamic = "force-dynamic";

function sanitizePortfolio(raw: Record<string, unknown>): PortfolioProfile | null {
  const id = String(raw.id || "").trim();
  if (!id) return null;
  const base =
    id === "default"
      ? { ...DEFAULT_PORTFOLIO }
      : id === "boriaz"
        ? { ...BORIAZ_PORTFOLIO }
        : makeCustomPortfolio({ id });
  const tf = String(raw.timeframe || base.timeframe);
  const timeframe =
    tf === "15m" || tf === "1h" || tf === "4h" || tf === "1d" ? tf : base.timeframe;
  const strategy =
    id === "boriaz"
      ? "smc"
      : String(raw.strategy || base.strategy) === "smc"
        ? "smc"
        : "alignment";
  return {
    ...base,
    name: String(raw.name || base.name).slice(0, 48),
    isDefault: id === "default",
    enabled: id === "default" || id === "boriaz" ? true : Boolean(raw.enabled ?? true),
    paperTradeEnabled: Boolean(raw.paperTradeEnabled ?? true),
    // LIVE réservé au portefeuille Boriaz (SMC)
    liveTradeEnabled:
      id === "boriaz" ? Boolean(raw.liveTradeEnabled ?? false) : false,
    bankrollEur: Math.min(100000, Math.max(100, Number(raw.bankrollEur) || 1000)),
    maxLeverage: Math.min(10, Math.max(1, Number(raw.maxLeverage) || 3)),
    sizePct: Math.min(25, Math.max(1, Number(raw.sizePct) || 10)),
    minRR: Math.min(10, Math.max(0.5, Number(raw.minRR) || 1.5)),
    targetEur: Math.max(10, Number(raw.targetEur) || 200),
    maxLossEur: Math.max(10, Number(raw.maxLossEur) || 150),
    tradesPerDay: Math.min(50, Math.max(0, Math.floor(Number(raw.tradesPerDay) || 5))),
    timeframe,
    riskLevel: Math.min(5, Math.max(1, Math.floor(Number(raw.riskLevel) || 2))),
    requireAiGate: Boolean(raw.requireAiGate ?? true),
    maxSafetyMode: Boolean(
      raw.maxSafetyMode ?? (id === "default" || id === "boriaz"),
    ),
    strategy,
    riskPct: id === "boriaz" ? 2 : Math.min(5, Math.max(0.5, Number(raw.riskPct) || 2)),
  };
}

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
        .slice(0, 40);
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
    if (typeof body.liveTradeEnabled === "boolean") {
      patch.liveTradeEnabled = body.liveTradeEnabled;
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
    if (Array.isArray(body.portfolios)) {
      const cleaned = (body.portfolios as Record<string, unknown>[])
        .map((p) => sanitizePortfolio(p))
        .filter((p): p is PortfolioProfile => Boolean(p))
        .slice(0, 8);
      patch.portfolios = ensurePortfolios(cleaned);
      const def = (patch.portfolios as PortfolioProfile[]).find((p) => p.isDefault);
      if (def) patch.paperBankrollEur = def.bankrollEur;
    }
    const prefs = await savePrefs(patch as Partial<typeof DEFAULT_PREFS>);
    return Response.json({ prefs, ok: true });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Prefs invalides" },
      { status: 400 },
    );
  }
}
