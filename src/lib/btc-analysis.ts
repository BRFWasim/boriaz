import { maybeAiBtcCommentary, ruleBasedBtcView } from "./ai-analysis";
import { parseNum } from "./format";
import { fetchCandleSnapshot } from "./hyperliquid";
import {
  atr,
  bollinger,
  ema,
  lastNumber,
  macd,
  rsi,
  sma,
} from "./indicators";
import { getIntegrationStatus } from "./integrations";
import type { BtcAnalysisPayload, Candle, IndicatorSnapshot } from "./types";

export async function getBtcAnalysis(): Promise<BtcAnalysisPayload> {
  const interval = "4h";
  const endTime = Date.now();
  const startTime = endTime - 180 * 4 * 3600 * 1000;
  const raw = await fetchCandleSnapshot({
    coin: "BTC",
    interval,
    startTime,
    endTime,
  });

  const candles: Candle[] = raw.map((c) => ({
    t: c.t,
    o: parseNum(c.o),
    h: parseNum(c.h),
    l: parseNum(c.l),
    c: parseNum(c.c),
    v: parseNum(c.v),
  }));

  const closes = candles.map((c) => c.c);
  const highs = candles.map((c) => c.h);
  const lows = candles.map((c) => c.l);
  const vols = candles.map((c) => c.v);

  const rsi14 = rsi(closes, 14);
  const macdSet = macd(closes);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const atr14 = atr(highs, lows, closes, 14);
  const bb = bollinger(closes, 20, 2);
  const price = closes.at(-1) ?? 0;
  const price24hAgo = closes.length > 6 ? closes[closes.length - 7] : null;
  const change24hPct =
    price24hAgo && price24hAgo > 0
      ? ((price - price24hAgo) / price24hAgo) * 100
      : null;
  const window = closes.slice(-48);
  const support = window.length ? Math.min(...window) : null;
  const resistance = window.length ? Math.max(...window) : null;

  const indicators: IndicatorSnapshot = {
    price,
    change24hPct,
    rsi14: lastNumber(rsi14),
    macd: lastNumber(macdSet.macd),
    macdSignal: lastNumber(macdSet.signal),
    macdHist: lastNumber(macdSet.hist),
    ema20: lastNumber(ema20),
    ema50: lastNumber(ema50),
    ema200: lastNumber(ema200),
    sma20: lastNumber(sma20),
    sma50: lastNumber(sma50),
    atr14: lastNumber(atr14),
    bbUpper: lastNumber(bb.upper),
    bbMiddle: lastNumber(bb.middle),
    bbLower: lastNumber(bb.lower),
    volumeAvg: lastNumber(sma(vols, 20)),
    support,
    resistance,
  };

  const view = ruleBasedBtcView(indicators);
  const ai = await maybeAiBtcCommentary({
    indicators,
    bias: view.bias,
    bullets: view.bullets,
  });
  const external = await fetchCoinGeckoContext();
  const integrations = getIntegrationStatus();

  return {
    symbol: "BTC",
    interval,
    candles: candles.slice(-90),
    indicators,
    bias: view.bias,
    score: view.score,
    horizon: "moyen terme (quelques jours → ~2 semaines, base 4h)",
    summary: view.summary,
    bullets: view.bullets,
    ai: {
      enabled: Boolean(ai.text),
      provider: ai.provider,
      text: ai.text,
      error: ai.error,
    },
    external,
    integrations,
    fetchedAt: Date.now(),
    disclaimer:
      "Analyse technique automatisée + IA optionnelle. Ce n’est pas un conseil financier. Les marchés crypto sont volatils.",
  };
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
    const headers: Record<string, string> = { Accept: "application/json" };
    const key = process.env.COINGECKO_API_KEY?.trim();
    if (key) headers["x-cg-pro-api-key"] = key;
    const url = key
      ? "https://pro-api.coingecko.com/api/v3/coins/bitcoin?localization=false&tickers=false&community_data=false&developer_data=false"
      : "https://api.coingecko.com/api/v3/coins/bitcoin?localization=false&tickers=false&community_data=false&developer_data=false";
    const res = await fetch(url, { headers, cache: "no-store" });
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
