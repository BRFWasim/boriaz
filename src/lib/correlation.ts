import { loadCandles } from "./market-analysis";

export interface SeriesPoint {
  t: number;
  v: number;
}

export interface CorrelationPayload {
  btc: SeriesPoint[];
  dxy: SeriesPoint[];
  yield10y: SeriesPoint[];
  corrBtcDxy: number | null;
  corrBtcYield: number | null;
  corrDxyYield: number | null;
  latest: {
    btc: number | null;
    dxy: number | null;
    yield10y: number | null;
  };
  fetchedAt: number;
  note: string;
  error: string | null;
}

async function yahooDaily(symbol: string, days = 90): Promise<SeriesPoint[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${days}d&interval=1d`;
  const res = await fetch(url, {
    headers: { "User-Agent": "BoriazBot/1.0" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Yahoo ${symbol} HTTP ${res.status}`);
  const json = (await res.json()) as {
    chart?: {
      result?: {
        timestamp?: number[];
        indicators?: { quote?: { close?: (number | null)[] }[] };
      }[];
    };
  };
  const result = json.chart?.result?.[0];
  const ts = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const out: SeriesPoint[] = [];
  for (let i = 0; i < ts.length; i++) {
    const v = closes[i];
    if (v == null || !Number.isFinite(v)) continue;
    out.push({ t: ts[i]! * 1000, v });
  }
  return out;
}

function alignReturns(
  a: SeriesPoint[],
  b: SeriesPoint[],
): { ra: number[]; rb: number[] } {
  const mapB = new Map(
    b.map((p) => [Math.floor(p.t / 86_400_000), p.v] as const),
  );
  const pairs: { a: number; b: number }[] = [];
  for (let i = 1; i < a.length; i++) {
    const day = Math.floor(a[i]!.t / 86_400_000);
    const prevDay = Math.floor(a[i - 1]!.t / 86_400_000);
    const vb = mapB.get(day);
    const vbPrev = mapB.get(prevDay);
    if (vb == null || vbPrev == null || vbPrev === 0 || a[i - 1]!.v === 0) {
      continue;
    }
    pairs.push({
      a: (a[i]!.v - a[i - 1]!.v) / a[i - 1]!.v,
      b: (vb - vbPrev) / vbPrev,
    });
  }
  return { ra: pairs.map((p) => p.a), rb: pairs.map((p) => p.b) };
}

function pearson(x: number[], y: number[]): number | null {
  const n = Math.min(x.length, y.length);
  if (n < 8) return null;
  const xs = x.slice(-n);
  const ys = y.slice(-n);
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i]! - mx;
    const b = ys[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx <= 0 || dy <= 0) return null;
  return num / Math.sqrt(dx * dy);
}

let cache: { at: number; value: CorrelationPayload } | null = null;
const TTL = 10 * 60_000;

export async function getMacroCorrelation(): Promise<CorrelationPayload> {
  if (cache && Date.now() - cache.at < TTL) return cache.value;

  const errors: string[] = [];
  let dxy: SeriesPoint[] = [];
  let yield10y: SeriesPoint[] = [];
  let btc: SeriesPoint[] = [];

  try {
    const candles = await loadCandles("BTC", "1d");
    btc = candles.map((c) => ({ t: c.t, v: c.c }));
  } catch (e) {
    errors.push(e instanceof Error ? e.message : "BTC");
  }

  try {
    dxy = await yahooDaily("DX-Y.NYB", 90);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : "DXY");
  }

  try {
    yield10y = await yahooDaily("^TNX", 90);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : "Yield");
  }

  const bd = alignReturns(btc, dxy);
  const by = alignReturns(btc, yield10y);
  const dy = alignReturns(dxy, yield10y);

  const value: CorrelationPayload = {
    btc: btc.slice(-60),
    dxy: dxy.slice(-60),
    yield10y: yield10y.slice(-60),
    corrBtcDxy: pearson(bd.ra, bd.rb),
    corrBtcYield: pearson(by.ra, by.rb),
    corrDxyYield: pearson(dy.ra, dy.rb),
    latest: {
      btc: btc.at(-1)?.v ?? null,
      dxy: dxy.at(-1)?.v ?? null,
      yield10y: yield10y.at(-1)?.v ?? null,
    },
    fetchedAt: Date.now(),
    note: "Corrélation des rendements journaliers ~60–90 j (BTC HL · DXY / US10Y Yahoo). Négative BTC↔DXY = classique risk-off dollar.",
    error: errors.length ? errors.join(" · ") : null,
  };
  cache = { at: Date.now(), value };
  return value;
}
