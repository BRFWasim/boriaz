export function ema(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function sma(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function rsi(values: number[], period = 14): Array<number | null> {
  const out: Array<number | null> = Array(values.length).fill(null);
  if (values.length <= period) return out;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i]! - values[i - 1]!;
    if (diff >= 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i]! - values[i - 1]!;
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export function macd(
  values: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): {
  macd: Array<number | null>;
  signal: Array<number | null>;
  hist: Array<number | null>;
} {
  const fastEma = ema(values, fast);
  const slowEma = ema(values, slow);
  const macdLine: Array<number | null> = values.map((_, i) =>
    fastEma[i] !== null && slowEma[i] !== null
      ? fastEma[i]! - slowEma[i]!
      : null,
  );
  const macdValues = macdLine.map((v) => v ?? 0);
  const firstValid = macdLine.findIndex((v) => v !== null);
  const signal = Array(values.length).fill(null) as Array<number | null>;
  const hist = Array(values.length).fill(null) as Array<number | null>;
  if (firstValid >= 0) {
    const slice = macdValues.slice(firstValid);
    const signalSlice = ema(slice, signalPeriod);
    for (let i = 0; i < signalSlice.length; i++) {
      const idx = firstValid + i;
      signal[idx] = signalSlice[i];
      if (macdLine[idx] !== null && signalSlice[i] !== null) {
        hist[idx] = macdLine[idx]! - signalSlice[i]!;
      }
    }
  }
  return { macd: macdLine, signal, hist };
}

export function atr(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): Array<number | null> {
  const tr: number[] = [highs[0]! - lows[0]!];
  for (let i = 1; i < closes.length; i++) {
    tr.push(
      Math.max(
        highs[i]! - lows[i]!,
        Math.abs(highs[i]! - closes[i - 1]!),
        Math.abs(lows[i]! - closes[i - 1]!),
      ),
    );
  }
  return sma(tr, period);
}

export function bollinger(
  values: number[],
  period = 20,
  mult = 2,
): {
  upper: Array<number | null>;
  middle: Array<number | null>;
  lower: Array<number | null>;
} {
  const middle = sma(values, period);
  const upper: Array<number | null> = Array(values.length).fill(null);
  const lower: Array<number | null> = Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const slice = values.slice(i - period + 1, i + 1);
    const mean = middle[i]!;
    const variance =
      slice.reduce((acc, v) => acc + (v - mean) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    upper[i] = mean + mult * std;
    lower[i] = mean - mult * std;
  }
  return { upper, middle, lower };
}

export function lastNumber(values: Array<number | null>): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (v !== null && Number.isFinite(v)) return v;
  }
  return null;
}

/** Stochastic %K / %D */
export function stochastic(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
  smooth = 3,
): { k: Array<number | null>; d: Array<number | null> } {
  const rawK: Array<number | null> = Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const hh = Math.max(...highs.slice(i - period + 1, i + 1));
    const ll = Math.min(...lows.slice(i - period + 1, i + 1));
    rawK[i] = hh === ll ? 50 : ((closes[i]! - ll) / (hh - ll)) * 100;
  }
  const kVals = rawK.map((v) => v ?? 0);
  const first = rawK.findIndex((v) => v !== null);
  const k: Array<number | null> = Array(closes.length).fill(null);
  const d: Array<number | null> = Array(closes.length).fill(null);
  if (first < 0) return { k, d };
  const kSmooth = sma(kVals.slice(first), smooth);
  for (let i = 0; i < kSmooth.length; i++) {
    k[first + i] = kSmooth[i];
  }
  const dSmooth = sma(
    k.map((v) => v ?? 0).slice(first),
    smooth,
  );
  for (let i = 0; i < dSmooth.length; i++) {
    d[first + i] = dSmooth[i];
  }
  return { k, d };
}

/** Rate of change % */
export function roc(values: number[], period = 12): Array<number | null> {
  const out: Array<number | null> = Array(values.length).fill(null);
  for (let i = period; i < values.length; i++) {
    const prev = values[i - period]!;
    out[i] = prev === 0 ? null : ((values[i]! - prev) / prev) * 100;
  }
  return out;
}

/** ADX simplifié (tendance 0–100) */
export function adx(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): Array<number | null> {
  const n = closes.length;
  const out: Array<number | null> = Array(n).fill(null);
  if (n < period * 2) return out;
  const tr: number[] = [0];
  const plusDM: number[] = [0];
  const minusDM: number[] = [0];
  for (let i = 1; i < n; i++) {
    const up = highs[i]! - highs[i - 1]!;
    const down = lows[i - 1]! - lows[i]!;
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
    tr.push(
      Math.max(
        highs[i]! - lows[i]!,
        Math.abs(highs[i]! - closes[i - 1]!),
        Math.abs(lows[i]! - closes[i - 1]!),
      ),
    );
  }
  let atr = tr.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  let pDM = plusDM.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  let mDM = minusDM.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  const dx: number[] = [];
  for (let i = period; i < n; i++) {
    if (i > period) {
      atr = (atr * (period - 1) + tr[i]!) / period;
      pDM = (pDM * (period - 1) + plusDM[i]!) / period;
      mDM = (mDM * (period - 1) + minusDM[i]!) / period;
    }
    const pDI = atr ? (pDM / atr) * 100 : 0;
    const mDI = atr ? (mDM / atr) * 100 : 0;
    const sum = pDI + mDI;
    dx.push(sum === 0 ? 0 : (Math.abs(pDI - mDI) / sum) * 100);
  }
  if (dx.length < period) return out;
  let adxVal = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const start = period * 2 - 1;
  out[start] = adxVal;
  for (let i = period; i < dx.length; i++) {
    adxVal = (adxVal * (period - 1) + dx[i]!) / period;
    out[period + i] = adxVal;
  }
  return out;
}
