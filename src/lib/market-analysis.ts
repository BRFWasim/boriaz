import { ruleBasedBtcView } from "./ai-analysis";
import { inferBuyTiming } from "./alerts";
import { parseNum } from "./format";
import { fetchCandleSnapshot } from "./hyperliquid";
import {
  atr,
  bollinger,
  ema,
  lastNumber,
  macd,
  roc,
  rsi,
  sma,
  stochastic,
  adx,
} from "./indicators";
import { computeBuyZone } from "./levels";
import { WATCHLIST } from "./price-watch";
import type {
  BuyZone,
  Candle,
  IndicatorSnapshot,
  TimeframeFrame,
} from "./types";

export type CandleInterval = "1h" | "4h" | "1d" | "1w";

function fmtPx(px: number): string {
  if (px >= 1000) return px.toFixed(0);
  if (px >= 10) return px.toFixed(2);
  if (px >= 1) return px.toFixed(3);
  return px.toFixed(5);
}

const INTERVAL_MS: Record<CandleInterval, number> = {
  "1h": 3600_000,
  "4h": 4 * 3600_000,
  "1d": 24 * 3600_000,
  "1w": 7 * 24 * 3600_000,
};

/** Combien de bougies charger par TF (≥220 pour EMA200, 1w plus court). */
const LOOKBACK: Record<CandleInterval, number> = {
  "1h": 260,
  "4h": 260,
  "1d": 260,
  "1w": 120,
};

export async function loadCandles(
  coin: string,
  interval: CandleInterval,
): Promise<Candle[]> {
  const endTime = Date.now();
  const startTime = endTime - LOOKBACK[interval] * INTERVAL_MS[interval];
  const raw = await fetchCandleSnapshot({
    coin,
    interval,
    startTime,
    endTime,
  });
  return raw.map((c) => ({
    t: c.t,
    o: parseNum(c.o),
    h: parseNum(c.h),
    l: parseNum(c.l),
    c: parseNum(c.c),
    v: parseNum(c.v),
  }));
}

export function buildIndicators(candles: Candle[]): IndicatorSnapshot {
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
  const stoch = stochastic(highs, lows, closes, 14, 3);
  const roc12 = roc(closes, 12);
  const adx14 = adx(highs, lows, closes, 14);
  const price = closes.at(-1) ?? 0;
  const volAvg = lastNumber(sma(vols, 20));
  const lastVol = vols.at(-1) ?? 0;
  const volumeRatio =
    volAvg && volAvg > 0 ? lastVol / volAvg : null;

  let change24hPct: number | null = null;
  let change7dPct: number | null = null;
  let change30dPct: number | null = null;
  if (candles.length > 1) {
    const lastT = candles.at(-1)?.t ?? 0;
    const pctSince = (ms: number) => {
      const target = lastT - ms;
      let ref = candles[0]!;
      for (const c of candles) {
        if (c.t <= target) ref = c;
      }
      return ref.c > 0 ? ((price - ref.c) / ref.c) * 100 : null;
    };
    change24hPct = pctSince(24 * 3600_000);
    change7dPct = pctSince(7 * 24 * 3600_000);
    change30dPct = pctSince(30 * 24 * 3600_000);
  }

  const window = closes.slice(-48);
  const support = window.length ? Math.min(...window) : null;
  const resistance = window.length ? Math.max(...window) : null;

  return {
    price,
    change24hPct,
    change7dPct,
    change30dPct,
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
    volumeAvg: volAvg,
    support,
    resistance,
    stochK: lastNumber(stoch.k),
    stochD: lastNumber(stoch.d),
    roc12: lastNumber(roc12),
    adx14: lastNumber(adx14),
    volumeRatio,
  };
}

export function analyzeTimeframe(
  coin: string,
  interval: CandleInterval,
  candles: Candle[],
  horizonLabel: string,
): TimeframeFrame {
  const indicators = buildIndicators(candles);
  const view = ruleBasedBtcView(indicators);
  // Remplace « BTC » générique dans les textes si besoin
  const summary = view.summary.replace(/moyen terme/i, horizonLabel);
  const buyZone = computeBuyZone(coin, indicators, view.bias, view.score);
  const buyTiming = inferBuyTiming({
    bias: view.bias,
    score: view.score,
    rsi: indicators.rsi14,
    macdHist: indicators.macdHist,
    price: indicators.price,
    support: indicators.support,
    bbLower: indicators.bbLower,
  });

  return {
    coin,
    interval,
    horizon: horizonLabel,
    candles: candles.slice(-90),
    indicators,
    bias: view.bias,
    score: view.score,
    summary,
    bullets: view.bullets.map((b) =>
      b.includes("Supports / résistances")
        ? b.replace(/(\d+\.\d+|\d+)/g, (m) => {
            const n = Number(m);
            return Number.isFinite(n) && n > 0 ? fmtPx(n) : m;
          })
        : b,
    ),
    buyTiming,
    buyZone,
  };
}

export async function analyzeCoinFrames(
  coin: string,
  frames: { interval: CandleInterval; horizon: string }[],
): Promise<TimeframeFrame[]> {
  const settled = await Promise.all(
    frames.map(async (frame) => {
      try {
        const candles = await loadCandles(coin, frame.interval);
        if (candles.length < 20) return null;
        return analyzeTimeframe(coin, frame.interval, candles, frame.horizon);
      } catch {
        return null;
      }
    }),
  );
  return settled.filter((f): f is TimeframeFrame => Boolean(f));
}

/** Watchlist : 1 TF 4h → zone d’achat (pas d’IA). */
export async function analyzeWatchlistBuyZones(): Promise<BuyZone[]> {
  const zones: BuyZone[] = [];
  for (const { coin } of WATCHLIST) {
    try {
      const candles = await loadCandles(coin, "4h");
      if (candles.length < 30) continue;
      const frame = analyzeTimeframe(
        coin,
        "4h",
        candles,
        "moyen terme (4h)",
      );
      zones.push(frame.buyZone);
    } catch {
      // skip coin
    }
  }
  return zones;
}
