import { dualAiBtcCommentary } from "./ai-analysis";
import { dispatchBtcAlerts } from "./alerts";
import {
  analyzeCoinFrames,
  analyzeWatchlistBuyZones,
} from "./market-analysis";
import { getIntegrationStatus } from "./integrations";
import { getWatchlistSnapshot, runPriceWatch } from "./price-watch";
import { resolveChatId } from "./telegram";
import type { BtcAnalysisPayload } from "./types";

const ANALYSIS_TTL_MS = 55_000;
let analysisCache: { at: number; value: BtcAnalysisPayload; withAi: boolean } | null =
  null;
let inflight: Promise<BtcAnalysisPayload> | null = null;

export async function getBtcAnalysis(options?: {
  notify?: boolean;
  /** true = appelle ChatGPT+Claude (sinon règles seules / cache IA). */
  includeAi?: boolean;
  force?: boolean;
}): Promise<BtcAnalysisPayload> {
  const includeAi = options?.includeAi === true;
  const notify = options?.notify === true;

  if (!options?.force && analysisCache && Date.now() - analysisCache.at < ANALYSIS_TTL_MS) {
    const hit = analysisCache.value;
    // Cache technique OK ; si on demande l’IA et qu’elle a été skip, on recalcule.
    if (!(includeAi && (hit.ai.skipped || !hit.ai.enabled))) {
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
      // mids optionnels
    }

    const [btcFrames, solFrames, watchBuyZones] = await Promise.all([
      analyzeCoinFrames("BTC", [
        { interval: "1h", horizon: "court terme (1h, heures → 1–2 jours)" },
        { interval: "4h", horizon: "moyen terme (4h, jours → ~2 semaines)" },
        { interval: "1d", horizon: "long terme (1d, semaines → mois)" },
      ]),
      analyzeCoinFrames("SOL", [
        { interval: "1h", horizon: "court terme SOL (1h)" },
        { interval: "4h", horizon: "moyen terme SOL (4h)" },
      ]),
      analyzeWatchlistBuyZones(),
    ]);

    const primary =
      btcFrames.find((f) => f.interval === "4h") ?? btcFrames[0];
    if (!primary) {
      throw new Error("Impossible de charger les bougies BTC Hyperliquid.");
    }

    const solPrimary =
      solFrames.find((f) => f.interval === "4h") ?? solFrames[0] ?? null;
    const solHint = solPrimary
      ? `bias ${solPrimary.bias} score ${solPrimary.score} zone ${solPrimary.buyZone.label} RSI ${solPrimary.indicators.rsi14?.toFixed(0) ?? "?"}`
      : undefined;

    const external = await fetchCoinGeckoContext();
    const ai = await dualAiBtcCommentary({
      indicators: primary.indicators,
      bias: primary.bias,
      bullets: primary.bullets,
      external: external.coingecko,
      solHint,
      includeAi,
      symbol: "BTC",
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
        buyZone: solPrimary?.buyZone ?? null,
      },
      watchBuyZones,
      watchQuotes: snap.quotes,
      priceWatch: {
        nextDigestAt: snap.nextDigestAt,
        lastDigestAt: snap.lastDigestAt,
      },
      ai: {
        enabled: ai.enabled,
        providers: ai.providers,
        consensus: ai.consensus,
        openai: ai.openai,
        anthropic: ai.anthropic,
        cached: ai.cached,
        skipped: ai.skipped,
      },
      telegram: { linked },
      external,
      integrations,
      fetchedAt: Date.now(),
      disclaimer:
        "Analyses techniques locales (multi-TF) + IA optionnelle mise en cache. Pas un conseil financier.",
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
      withAi: includeAi && (ai.enabled || Boolean(ai.cached)),
    };
    return payload;
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}

/** Déclenché par le poll dashboard : mids + spikes + digest 2h (0 token IA). */
export async function tickPriceWatch() {
  return runPriceWatch();
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
