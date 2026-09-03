import { loadCandles } from "./market-analysis";
import { ema, lastNumber, rsi } from "./indicators";

export interface BacktestTrade {
  coin: string;
  side: "long" | "short";
  entryAt: number;
  exitAt: number;
  entry: number;
  exit: number;
  pnlPct: number;
  rule: string;
  alignmentProxy: number;
}

export interface BacktestPayload {
  days: number;
  coins: string[];
  engine: "correlated" | "rsi";
  trades: BacktestTrade[];
  winRate: number | null;
  avgPnlPct: number | null;
  profitFactor: number | null;
  expectancyPct: number | null;
  sample: number;
  note: string;
  fetchedAt: number;
}

function biasFromScore(score: number): "long" | "short" | "wait" {
  if (score >= 3) return "long";
  if (score <= -3) return "short";
  return "wait";
}

/**
 * Score proxy multi-TF sur une barre i (sans crowd/Nansen live historique).
 * 1h ≈ 4h/4, 4h = barre 4h, 1d ≈ 4h/6.
 */
function tfScoreAt(
  closes: number[],
  i: number,
  lookbackFast: number,
  lookbackSlow: number,
): number {
  if (i < lookbackSlow + 2) return 0;
  const slice = closes.slice(0, i + 1);
  const r = rsi(slice, 14);
  const e20 = ema(slice, 20);
  const e50 = ema(slice, 50);
  const curR = lastNumber(r) ?? 50;
  const curE20 = lastNumber(e20);
  const curE50 = lastNumber(e50);
  const px = closes[i]!;
  const pxFast = closes[Math.max(0, i - lookbackFast)]!;
  const pxSlow = closes[Math.max(0, i - lookbackSlow)]!;
  let s = 0;
  if (curR <= 32) s += 3;
  else if (curR <= 42) s += 2;
  else if (curR >= 68) s -= 3;
  else if (curR >= 58) s -= 2;
  if (curE20 != null && curE50 != null) {
    if (curE20 > curE50) s += 2;
    else s -= 2;
  }
  const momFast = ((px - pxFast) / pxFast) * 100;
  const momSlow = ((px - pxSlow) / pxSlow) * 100;
  if (momFast > 1.2) s += 2;
  else if (momFast < -1.2) s -= 2;
  if (momSlow > 2.5) s += 2;
  else if (momSlow < -2.5) s -= 2;
  return s;
}

/**
 * Backtest moteur corrélé multi-TF (1h proxy + 4h + 1d proxy) sur 90 j.
 * Entrée seulement si 1h et 4h alignés (sureté max proxy).
 */
export async function runCorrelatedBacktest(options?: {
  days?: number;
  coins?: string[];
}): Promise<BacktestPayload> {
  const days = options?.days ?? 90;
  const coins = options?.coins ?? [
    "BTC",
    "ETH",
    "SOL",
    "UNI",
    "AVAX",
    "LINK",
  ];
  const trades: BacktestTrade[] = [];
  const holdBars = 10; // ~40h on 4h
  const tpPct = 3.5;
  const slPct = 2.0;

  for (const coin of coins) {
    try {
      const candles = await loadCandles(coin, "4h");
      const cutoff = Date.now() - days * 86_400_000;
      const slice = candles.filter((c) => c.t >= cutoff);
      if (slice.length < 80) continue;
      const closes = slice.map((c) => c.c);

      let i = 60;
      while (i < slice.length - 1) {
        // Proxies : «1h» = momentum court (1 barre≈4h → lookback 1), «4h» lookback 3, «1d» lookback 6
        const s1h = tfScoreAt(closes, i, 1, 2);
        const s4h = tfScoreAt(closes, i, 3, 6);
        const s1d = tfScoreAt(closes, i, 6, 12);
        const a1 = biasFromScore(s1h);
        const a4 = biasFromScore(s4h);
        const a1d = biasFromScore(s1d);

        let side: "long" | "short" | null = null;
        let rule = "";
        let alignProxy = 40;

        // Sureté max proxy : 1h + 4h alignés
        if (a1 === "long" && a4 === "long") {
          side = "long";
          rule = `1h+4h LONG (s ${s1h}/${s4h})`;
          alignProxy = 55 + Math.min(25, s1h + s4h);
          if (a1d === "long") {
            alignProxy += 10;
            rule += " · 1d OK";
          } else if (a1d === "short") {
            alignProxy -= 12;
            rule += " · 1d contraire";
          }
        } else if (a1 === "short" && a4 === "short") {
          side = "short";
          rule = `1h+4h SHORT (s ${s1h}/${s4h})`;
          alignProxy = 55 + Math.min(25, Math.abs(s1h) + Math.abs(s4h));
          if (a1d === "short") {
            alignProxy += 10;
            rule += " · 1d OK";
          } else if (a1d === "long") {
            alignProxy -= 12;
            rule += " · 1d contraire";
          }
        }

        if (!side || alignProxy < 52) {
          i += 1;
          continue;
        }

        const entry = slice[i]!.c;
        const entryAt = slice[i]!.t;
        let exit = entry;
        let exitAt = entryAt;
        let closed = false;
        for (let j = i + 1; j <= Math.min(i + holdBars, slice.length - 1); j++) {
          const px = slice[j]!.c;
          exit = px;
          exitAt = slice[j]!.t;
          const pnl =
            side === "long"
              ? ((px - entry) / entry) * 100
              : ((entry - px) / entry) * 100;
          if (pnl >= tpPct || pnl <= -slPct) {
            closed = true;
            break;
          }
        }
        if (!closed && i + holdBars < slice.length) {
          exit = slice[i + holdBars]!.c;
          exitAt = slice[i + holdBars]!.t;
        }
        const pnlPct =
          side === "long"
            ? ((exit - entry) / entry) * 100
            : ((entry - exit) / entry) * 100;
        trades.push({
          coin,
          side,
          entryAt,
          exitAt,
          entry,
          exit,
          pnlPct,
          rule,
          alignmentProxy: Math.round(alignProxy),
        });
        i += holdBars;
      }
    } catch {
      // skip coin
    }
  }

  const sample = trades.length;
  const wins = trades.filter((t) => t.pnlPct > 0);
  const losses = trades.filter((t) => t.pnlPct <= 0);
  const sumW = wins.reduce((s, t) => s + t.pnlPct, 0);
  const sumL = Math.abs(losses.reduce((s, t) => s + t.pnlPct, 0));
  const avg =
    sample > 0 ? trades.reduce((s, t) => s + t.pnlPct, 0) / sample : null;

  return {
    days,
    coins,
    engine: "correlated",
    trades: trades.slice(-100),
    winRate: sample ? wins.length / sample : null,
    avgPnlPct: avg,
    profitFactor: sumL > 0 ? sumW / sumL : sumW > 0 ? null : null,
    expectancyPct: avg,
    sample,
    note: "Backtest moteur corrélé multi-TF (proxy 1h+4h+1d, sureté max). Pas de crowd/Nansen historique. Éducatif — pas une perf garantie.",
    fetchedAt: Date.now(),
  };
}

/** @deprecated alias — le Lab utilise le moteur corrélé. */
export async function runSimpleBacktest(options?: {
  days?: number;
  coins?: string[];
}): Promise<BacktestPayload> {
  return runCorrelatedBacktest(options);
}
