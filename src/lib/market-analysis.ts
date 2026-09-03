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
  rsi,
  sma,
} from "./indicators";
import { WATCHLIST } from "./price-watch";
import type {
  BuyZone,
  Candle,
  IndicatorSnapshot,
  SignalBias,
  TimeframeFrame,
} from "./types";

export type CandleInterval = "1h" | "4h" | "1d";

const INTERVAL_MS: Record<CandleInterval, number> = {
  "1h": 3600_000,
  "4h": 4 * 3600_000,
  "1d": 24 * 3600_000,
};

/** Combien de bougies charger par TF (≥220 pour EMA200). */
const LOOKBACK: Record<CandleInterval, number> = {
  "1h": 260,
  "4h": 260,
  "1d": 260,
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
  const price = closes.at(-1) ?? 0;

  let change24hPct: number | null = null;
  if (candles.length > 1) {
    const target = (candles.at(-1)?.t ?? 0) - 24 * 3600_000;
    let ref = candles[0]!;
    for (const c of candles) {
      if (c.t <= target) ref = c;
    }
    if (ref.c > 0) change24hPct = ((price - ref.c) / ref.c) * 100;
  }

  const window = closes.slice(-48);
  const support = window.length ? Math.min(...window) : null;
  const resistance = window.length ? Math.max(...window) : null;

  return {
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
}

function fmtPx(px: number): string {
  if (px >= 1000) return px.toFixed(0);
  if (px >= 10) return px.toFixed(2);
  if (px >= 1) return px.toFixed(3);
  return px.toFixed(5);
}

/**
 * Zone d’achat idéale 100 % règles (0 token IA).
 * Basée sur support / BB basse / EMA50 / ATR.
 */
export function computeBuyZone(
  coin: string,
  ind: IndicatorSnapshot,
  bias: SignalBias,
  score: number,
): BuyZone {
  const price = ind.price;
  const atr = ind.atr14 ?? price * 0.02;
  const floorCandidates = [
    ind.bbLower,
    ind.support,
    ind.ema50 !== null ? ind.ema50 - atr * 0.35 : null,
    ind.ema20 !== null ? ind.ema20 - atr * 0.5 : null,
  ].filter((v): v is number => v !== null && v > 0 && v < price * 1.02);

  let low =
    floorCandidates.length > 0
      ? Math.max(...floorCandidates.filter((v) => v <= price * 1.005))
      : price - atr * 1.2;
  if (!Number.isFinite(low) || low <= 0) low = price * 0.97;

  let high = Math.min(
    price,
    low + atr * 0.9,
    ind.ema20 ?? low + atr * 0.7,
    ind.bbMiddle ?? low + atr,
  );
  if (high <= low) high = low + atr * 0.6;

  const mid = (low + high) / 2;
  const distPct = price > 0 ? ((price - mid) / price) * 100 : 0;

  const buyTiming = inferBuyTiming({
    bias,
    score,
    rsi: ind.rsi14,
    macdHist: ind.macdHist,
    price,
    support: ind.support,
    bbLower: ind.bbLower,
  });

  let quality = buyTiming.confidence;
  if (bias === "baissier" && score <= -4) quality = Math.min(quality, 35);
  if (distPct > 4) quality = Math.max(20, quality - 15);

  const invalidation =
    ind.support !== null
      ? ind.support - atr * 0.4
      : low - atr * 0.5;

  return {
    coin,
    low,
    high,
    mid,
    distancePct: distPct,
    quality,
    action: buyTiming.action,
    reason: buyTiming.reason,
    label: `${fmtPx(low)} → ${fmtPx(high)}`,
    invalidation,
    summary: `Zone idéale ${fmtPx(low)}–${fmtPx(high)} (${buyTiming.action.replaceAll("_", " ")}, qualité ${quality}/100). Invalidation ~ ${fmtPx(invalidation)}.`,
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
  const results: TimeframeFrame[] = [];
  // Séquentiel léger pour éviter de saturer l’API HL
  for (const frame of frames) {
    const candles = await loadCandles(coin, frame.interval);
    if (candles.length < 30) continue;
    results.push(
      analyzeTimeframe(coin, frame.interval, candles, frame.horizon),
    );
  }
  return results;
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
