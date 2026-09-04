import { bindUserRequest } from "@/lib/bind-request";
import { loadPrefs, ensurePortfolios } from "@/lib/persist";
import { getWatchlistSnapshot } from "@/lib/price-watch";
import { scanSmcWatchlist } from "@/lib/smc-scan";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  await bindUserRequest();
  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";
  const coin = url.searchParams.get("coin")?.toUpperCase();

  const prefs = await loadPrefs();
  const portfolios = ensurePortfolios(prefs.portfolios);
  const boriaz = portfolios.find((p) => p.id === "boriaz") ?? portfolios.find((p) => p.strategy === "smc");
  const walletEur = boriaz?.bankrollEur ?? 1000;
  const maxLeverage = boriaz?.maxLeverage ?? 3;

  const quotes = await getWatchlistSnapshot().catch(() => null);
  const prices: Record<string, number> = {};
  for (const q of quotes?.quotes ?? []) prices[q.coin] = q.price;

  const coins = coin
    ? [coin]
    : prefs.watchCoins.slice(0, 8);

  const scan = await scanSmcWatchlist({
    coins,
    walletEur,
    maxLeverage,
    prices,
    force,
  });

  return Response.json({
    ...scan,
    portfolio: boriaz
      ? {
          id: boriaz.id,
          name: boriaz.name,
          bankrollEur: boriaz.bankrollEur,
          riskPct: boriaz.riskPct,
          strategy: boriaz.strategy,
        }
      : null,
    disclaimer:
      "Analyse SMC éducative (Boriaz). Pas un conseil financier ni un ordre réel.",
  });
}
