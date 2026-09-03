import { batchWatchlistAi, dualAiBtcCommentary } from "./ai-analysis";
import { dispatchBtcAlerts } from "./alerts";
import {
  analyzeCoinFrames,
  analyzeWatchlistBuyZones,
} from "./market-analysis";
import { getIntegrationStatus } from "./integrations";
import { fetchNansenSnapshot } from "./nansen";
import { WATCHLIST, getWatchlistSnapshot, runPriceWatch } from "./price-watch";
import { resolveChatId } from "./telegram";
import type { BtcAnalysisPayload, TimeframeFrame } from "./types";

const ANALYSIS_TTL_MS = 55_000;
let analysisCache: {
  at: number;
  value: BtcAnalysisPayload;
  withAi: boolean;
} | null = null;
let inflight: Promise<BtcAnalysisPayload> | null = null;

export async function getBtcAnalysis(options?: {
  notify?: boolean;
  includeAi?: boolean;
  force?: boolean;
}): Promise<BtcAnalysisPayload> {
  const includeAi = options?.includeAi === true;
  const notify = options?.notify === true;

  if (
    !options?.force &&
    analysisCache &&
    Date.now() - analysisCache.at < ANALYSIS_TTL_MS
  ) {
    const hit = analysisCache.value;
    if (!(includeAi && (hit.ai.skipped || hit.watchAi?.skipped))) {
      const snap = await getWatchlistSnapshot();
      return {
        ...hit,
        watchQuotes: snap.quotes,
        priceWatch: {
          nextDigestAt: snap.nextDigestAt,
          lastDigestAt: snap.lastDigestAt,
        },
        fetchedAt: Date.now(),
      };
    }
  }

  if (inflight && !options?.force) return inflight;

  inflight = (async () => {
    try {
      await runPriceWatch();
    } catch {
      // ignore
    }

    const watchCoins = WATCHLIST.map((w) => w.coin);

    const frameJobs = watchCoins.map((coin) =>
      analyzeCoinFrames(coin, [
        { interval: "1h", horizon: `court ${coin} (1h)` },
        { interval: "4h", horizon: `moyen ${coin} (4h)` },
        { interval: "1d", horizon: `long ${coin} (1d)` },
        { interval: "1w", horizon: `très long ${coin} (1w)` },
      ]),
    );

    const [allFrames, watchBuyZones, nansen] = await Promise.all([
      Promise.all(frameJobs),
      analyzeWatchlistBuyZones(),
      fetchNansenSnapshot(),
    ]);

    const byCoin = new Map<string, TimeframeFrame[]>();
    watchCoins.forEach((coin, i) => {
      byCoin.set(coin, allFrames[i] ?? []);
    });

    const btcFrames = byCoin.get("BTC") ?? [];
    const solFrames = byCoin.get("SOL") ?? [];
    const primary =
      btcFrames.find((f) => f.interval === "4h") ?? btcFrames[0];
    if (!primary) {
      throw new Error("Impossible de charger les bougies BTC Hyperliquid.");
    }

    const assetInputs = watchCoins
      .map((coin) => {
        const frames = byCoin.get(coin) ?? [];
        const main =
          frames.find((f) => f.interval === "4h") ?? frames[0] ?? null;
        if (!main) return null;
        return {
          coin,
          bias: main.bias,
          score: main.score,
          buyZone: main.buyZone.label,
          indicators: main.indicators,
          frames,
          buyZoneFull: main.buyZone,
        };
      })
      .filter(Boolean) as {
      coin: string;
      bias: TimeframeFrame["bias"];
      score: number;
      buyZone: string;
      indicators: TimeframeFrame["indicators"];
      frames: TimeframeFrame[];
      buyZoneFull: TimeframeFrame["buyZone"];
    }[];

    const external = await fetchCoinGeckoContext();
    const [watchAi, dualFixed] = await Promise.all([
      batchWatchlistAi({
        assets: assetInputs.map((a) => ({
          coin: a.coin,
          bias: a.bias,
          score: a.score,
          buyZone: a.buyZone,
          indicators: a.indicators,
          tf: a.frames.map((f) => ({
            interval: f.interval,
            bias: f.bias,
            score: f.score,
          })),
        })),
        includeAi,
      }),
      dualAiBtcCommentary({
        indicators: primary.indicators,
        bias: primary.bias,
        bullets: primary.bullets,
        external: external.coingecko,
        includeAi,
        symbol: "BTC",
        solHint: solFrames[0]
          ? `SOL ${solFrames.find((f) => f.interval === "4h")?.bias ?? solFrames[0].bias}`
          : undefined,
      }),
    ]);

    const aiBriefByCoin = new Map(
      watchAi.briefs.map((b) => [b.coin.toUpperCase(), b.text]),
    );

    const assetAnalyses = assetInputs.map((a) => {
      const label =
        WATCHLIST.find((w) => w.coin === a.coin)?.label ?? a.coin;
      return {
        coin: a.coin,
        label,
        timeframes: a.frames,
        buyZone: a.buyZoneFull,
        aiText:
          aiBriefByCoin.get(a.coin) ??
          (aiBriefByCoin.get("ALL")
            ? `${label}: ${aiBriefByCoin.get("ALL")}`
            : ruleFallbackText(a.frames, label)),
      };
    });

    const integrations = getIntegrationStatus();
    const linked = Boolean(await resolveChatId());
    const snap = await getWatchlistSnapshot();

    const payload: BtcAnalysisPayload = {
      symbol: "BTC",
      interval: primary.interval,
      candles: primary.candles,
      indicators: primary.indicators,
      bias: primary.bias,
      score: primary.score,
      horizon: primary.horizon,
      summary: primary.summary,
      bullets: primary.bullets,
      buyTiming: primary.buyTiming,
      buyZone: primary.buyZone,
      timeframes: btcFrames,
      sol: {
        timeframes: solFrames,
        buyZone:
          solFrames.find((f) => f.interval === "4h")?.buyZone ??
          solFrames[0]?.buyZone ??
          null,
      },
      watchBuyZones,
      watchQuotes: snap.quotes,
      assetAnalyses,
      watchAi: {
        enabled: watchAi.enabled,
        cached: watchAi.cached,
        skipped: watchAi.skipped,
        provider: watchAi.provider,
        error: watchAi.error,
      },
      traderTrends: {
        nansenEnabled: nansen.enabled,
        nansenError: nansen.error,
        smartFlows: nansen.smartFlows.slice(0, 10).map((f) => ({
          symbol: f.symbol,
          chain: f.chain,
          netFlow24hUsd: f.netFlow24hUsd,
          traderCount: f.traderCount,
        })),
        recentPerpTrades: nansen.recentPerpTrades.slice(0, 16).map((t) => ({
          label: t.label,
          symbol: t.symbol,
          side: t.side,
          action: t.action,
          valueUsd: t.valueUsd,
          at: t.at,
        })),
        leaderboard: nansen.leaderboard.slice(0, 10).map((r) => ({
          label: r.label,
          address: r.address,
          totalPnl: r.totalPnl,
          roi: r.roi,
          topCoin: r.topCoin,
          topSide: r.topSide,
          topValueUsd: r.topValueUsd,
        })),
        hlWhales: [],
      },
      priceWatch: {
        nextDigestAt: snap.nextDigestAt,
        lastDigestAt: snap.lastDigestAt,
      },
      ai: {
        enabled: dualFixed.enabled,
        providers: dualFixed.providers,
        consensus: dualFixed.consensus,
        openai: dualFixed.openai,
        anthropic: dualFixed.anthropic,
        cached: dualFixed.cached,
        skipped: dualFixed.skipped,
      },
      telegram: { linked },
      external,
      integrations,
      fetchedAt: Date.now(),
      disclaimer:
        "Analyses techniques multi-indicateurs + IA batch (cache). Nansen smart money si clé. Pas un conseil financier.",
    };

    if (notify) {
      const dispatch = await dispatchBtcAlerts(payload);
      payload.telegram.lastDispatch = {
        sent: dispatch.sent,
        errors: dispatch.errors,
      };
    }

    analysisCache = {
      at: Date.now(),
      value: payload,
      withAi: includeAi && (watchAi.enabled || dualFixed.enabled),
    };
    return payload;
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}

export async function tickPriceWatch() {
  return runPriceWatch();
}

function ruleFallbackText(
  frames: TimeframeFrame[],
  label: string,
): string {
  const d = frames.find((f) => f.interval === "1d");
  const w = frames.find((f) => f.interval === "1w");
  const h = frames.find((f) => f.interval === "4h");
  const parts = [
    `${label} (règles, IA absente) :`,
    h ? `4h ${h.bias} (${h.score})` : null,
    d
      ? `1d ${d.bias} (${d.score}) · 7j ${d.indicators.change7dPct?.toFixed(1) ?? "n/d"}% · 30j ${d.indicators.change30dPct?.toFixed(1) ?? "n/d"}%`
      : null,
    w ? `1w ${w.bias} (${w.score})` : null,
    d?.summary ?? h?.summary ?? "",
  ].filter(Boolean);
  return parts.join(" · ");
}

async function fetchCoinGeckoContext(): Promise<BtcAnalysisPayload["external"]> {
  const empty = {
    coingecko: {
      enabled: false,
      marketCapUsd: null,
      volume24hUsd: null,
      priceChange7dPct: null,
      priceChange30dPct: null,
    },
  };
  try {
    const key = process.env.COINGECKO_API_KEY?.trim();
    const headers: Record<string, string> = { Accept: "application/json" };
    let url =
      "https://api.coingecko.com/api/v3/coins/bitcoin?localization=false&tickers=false&community_data=false&developer_data=false";
    if (key) {
      headers["x-cg-demo-api-key"] = key;
      headers["x-cg-pro-api-key"] = key;
    }
    let res = await fetch(url, { headers, cache: "no-store" });
    if (!res.ok && key) {
      url =
        "https://pro-api.coingecko.com/api/v3/coins/bitcoin?localization=false&tickers=false&community_data=false&developer_data=false";
      res = await fetch(url, {
        headers: { Accept: "application/json", "x-cg-pro-api-key": key },
        cache: "no-store",
      });
    }
    if (!res.ok) return empty;
    const json = (await res.json()) as {
      market_data?: {
        market_cap?: { usd?: number };
        total_volume?: { usd?: number };
        price_change_percentage_7d?: number;
        price_change_percentage_30d?: number;
      };
    };
    const md = json.market_data;
    return {
      coingecko: {
        enabled: true,
        marketCapUsd: md?.market_cap?.usd ?? null,
        volume24hUsd: md?.total_volume?.usd ?? null,
        priceChange7dPct: md?.price_change_percentage_7d ?? null,
        priceChange30dPct: md?.price_change_percentage_30d ?? null,
      },
    };
  } catch {
    return empty;
  }
}
