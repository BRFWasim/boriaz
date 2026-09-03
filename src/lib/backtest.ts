import { loadCandles } from "./market-analysis";
import { lastNumber, rsi } from "./indicators";

export interface BacktestTrade {
  coin: string;
  side: "long" | "short";
  entryAt: number;
  exitAt: number;
  entry: number;
  exit: number;
  pnlPct: number;
  rule: string;
}

export interface BacktestPayload {
  days: number;
  coins: string[];
  trades: BacktestTrade[];
  winRate: number | null;
  avgPnlPct: number | null;
  profitFactor: number | null;
  expectancyPct: number | null;
  sample: number;
  note: string;
  fetchedAt: number;
}

/**
 * Backtest simple : RSI(14) sur 4h.
 * Long si RSI croise au-dessus de 32 ; short si croise sous 68.
 * Sortie après N barres ou stop/TP ATR-like (±3 %).
 */
export async function runSimpleBacktest(options?: {
  days?: number;
  coins?: string[];
}): Promise<BacktestPayload> {
  const days = options?.days ?? 60;
  const coins = options?.coins ?? ["BTC", "ETH", "SOL", "UNI"];
  const trades: BacktestTrade[] = [];
  const holdBars = 8; // ~32h on 4h
  const tpPct = 3.2;
  const slPct = 2.0;

  for (const coin of coins) {
    try {
      const candles = await loadCandles(coin, "4h");
      const cutoff = Date.now() - days * 86_400_000;
      const slice = candles.filter((c) => c.t >= cutoff);
      if (slice.length < 40) continue;
      const closes = slice.map((c) => c.c);
      const r = rsi(closes, 14);

      let i = 20;
      while (i < slice.length - 1) {
        const prev = lastNumber(r.slice(0, i)) ?? 50;
        const cur = r[i] ?? 50;
        let side: "long" | "short" | null = null;
        let rule = "";
        if (prev < 32 && cur >= 32) {
          side = "long";
          rule = "RSI croise ↑ 32";
        } else if (prev > 68 && cur <= 68) {
          side = "short";
          rule = "RSI croise ↓ 68";
        }
        if (!side) {
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
    trades: trades.slice(-80),
    winRate: sample ? wins.length / sample : null,
    avgPnlPct: avg,
    profitFactor: sumL > 0 ? sumW / sumL : sumW > 0 ? null : null,
    expectancyPct: avg,
    sample,
    note: "Backtest éducatif RSI 4h (pas crowd live). Pas une performance garantie.",
    fetchedAt: Date.now(),
  };
}
