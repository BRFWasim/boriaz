/**
 * Position du prix dans les ranges BTC (et coin) long / moyen / court terme.
 * Empêche les shorts en bas de range et les longs en haut — cohérence macro.
 */

import { loadCandles } from "./market-analysis";
import type { Candle } from "./types";

export type RangeBand = "bottom" | "lower" | "mid" | "upper" | "top";

export type TimeRangeSnapshot = {
  tf: "1w" | "1d" | "4h";
  low: number;
  high: number;
  mid: number;
  /** 0 = bas du range, 1 = haut */
  pos: number;
  band: RangeBand;
};

export type MarketRangeContext = {
  coin: string;
  price: number;
  weekly: TimeRangeSnapshot | null;
  daily: TimeRangeSnapshot | null;
  h4: TimeRangeSnapshot | null;
  /** Résumé FR pour prompts / UI */
  summary: string;
  /** true si short macro-interdit (bas de range long/moyen) */
  blockShort: boolean;
  /** true si long macro-interdit (haut de range long/moyen) */
  blockLong: boolean;
  reason: string;
};

function bandFromPos(pos: number): RangeBand {
  if (pos <= 0.18) return "bottom";
  if (pos <= 0.35) return "lower";
  if (pos <= 0.65) return "mid";
  if (pos <= 0.82) return "upper";
  return "top";
}

function rangeFromCandles(
  tf: TimeRangeSnapshot["tf"],
  candles: Candle[],
  price: number,
  lookback: number,
): TimeRangeSnapshot | null {
  if (!candles.length || !(price > 0)) return null;
  const slice = candles.slice(-lookback);
  if (slice.length < 8) return null;
  let low = Infinity;
  let high = -Infinity;
  for (const c of slice) {
    if (c.l < low) low = c.l;
    if (c.h > high) high = c.h;
  }
  if (!(high > low) || !Number.isFinite(low) || !Number.isFinite(high)) {
    return null;
  }
  const pos = Math.min(1, Math.max(0, (price - low) / (high - low)));
  return {
    tf,
    low,
    high,
    mid: (low + high) / 2,
    pos: Math.round(pos * 1000) / 1000,
    band: bandFromPos(pos),
  };
}

function bandLabel(b: RangeBand): string {
  switch (b) {
    case "bottom":
      return "BAS";
    case "lower":
      return "bas-médian";
    case "mid":
      return "milieu";
    case "upper":
      return "haut-médian";
    case "top":
      return "HAUT";
  }
}

/**
 * Contexte range multi-horizon pour un coin (BTC en priorité pour le filtre LIVE).
 */
export async function getMarketRangeContext(
  coin: string,
  priceHint?: number,
): Promise<MarketRangeContext> {
  const [w, d, h4] = await Promise.all([
    loadCandles(coin, "1w").catch(() => [] as Candle[]),
    loadCandles(coin, "1d").catch(() => [] as Candle[]),
    loadCandles(coin, "4h").catch(() => [] as Candle[]),
  ]);
  const price =
    priceHint && priceHint > 0
      ? priceHint
      : h4.at(-1)?.c || d.at(-1)?.c || w.at(-1)?.c || 0;

  const weekly = rangeFromCandles("1w", w, price, 52);
  const daily = rangeFromCandles("1d", d, price, 90);
  const h4r = rangeFromCandles("4h", h4, price, 90);

  // Short interdit : bas du range weekly OU daily (demande utilisateur)
  const macroLow =
    (weekly && (weekly.band === "bottom" || weekly.band === "lower")) ||
    (daily && daily.band === "bottom");
  // Long interdit : haut du range weekly OU daily
  const macroHigh =
    (weekly && (weekly.band === "top" || weekly.band === "upper")) ||
    (daily && daily.band === "top");

  const blockShort = Boolean(macroLow);
  const blockLong = Boolean(macroHigh);

  let reason = "Range neutre / milieu — direction ouverte si SMC OK";
  if (blockShort && blockLong) {
    reason =
      "Contexte mixte extrême — privilégier attendre (pas d’ordre forcé)";
  } else if (blockShort) {
    reason = `Prix en ${bandLabel(daily?.band ?? weekly?.band ?? "bottom")} du range long/moyen — SHORT interdit (rebond / liquidité basse)`;
  } else if (blockLong) {
    reason = `Prix en ${bandLabel(daily?.band ?? weekly?.band ?? "top")} du range long/moyen — LONG interdit (prise de liquidité haute)`;
  }

  const parts = [
    weekly
      ? `W ${bandLabel(weekly.band)} (${(weekly.pos * 100).toFixed(0)}% ${weekly.low.toFixed(0)}–${weekly.high.toFixed(0)})`
      : null,
    daily
      ? `D1 ${bandLabel(daily.band)} (${(daily.pos * 100).toFixed(0)}% ${daily.low.toFixed(0)}–${daily.high.toFixed(0)})`
      : null,
    h4r
      ? `H4 ${bandLabel(h4r.band)} (${(h4r.pos * 100).toFixed(0)}%)`
      : null,
  ].filter(Boolean);

  return {
    coin: coin.toUpperCase(),
    price,
    weekly,
    daily,
    h4: h4r,
    summary: parts.join(" · ") || "Range indisponible",
    blockShort,
    blockLong,
    reason,
  };
}

/** BTC d’abord (filtre global), puis le coin tradé. */
export async function getTradeRangeGate(opts: {
  coin: string;
  side: "long" | "short";
  price?: number;
  tradeKind?: "continuation" | "correction" | null;
}): Promise<{
  ok: boolean;
  reason: string;
  btc: MarketRangeContext;
  coinCtx: MarketRangeContext | null;
}> {
  const btc = await getMarketRangeContext("BTC", opts.coin === "BTC" ? opts.price : undefined);
  let coinCtx: MarketRangeContext | null = null;
  if (opts.coin.toUpperCase() !== "BTC") {
    coinCtx = await getMarketRangeContext(opts.coin, opts.price);
  }

  const side = opts.side;
  const correction = opts.tradeKind === "correction";

  // Filtre BTC macro (tous les alts suivent le risque BTC)
  if (side === "short" && btc.blockShort) {
    return {
      ok: false,
      reason: `BTC ${btc.summary} — ${btc.reason}. Pas de SHORT (surtout correction) en bas de range.`,
      btc,
      coinCtx,
    };
  }
  if (side === "long" && btc.blockLong) {
    return {
      ok: false,
      reason: `BTC ${btc.summary} — ${btc.reason}. Pas de LONG en haut de range.`,
      btc,
      coinCtx,
    };
  }

  // Filtre coin local (plus strict sur corrections)
  if (coinCtx) {
    if (side === "short" && coinCtx.blockShort && correction) {
      return {
        ok: false,
        reason: `${opts.coin} ${coinCtx.summary} — SHORT correction refusé en bas de range.`,
        btc,
        coinCtx,
      };
    }
    if (side === "long" && coinCtx.blockLong && correction) {
      return {
        ok: false,
        reason: `${opts.coin} ${coinCtx.summary} — LONG correction refusé en haut de range.`,
        btc,
        coinCtx,
      };
    }
  }

  return {
    ok: true,
    reason: `Range OK · BTC ${btc.summary}${coinCtx ? ` · ${opts.coin} ${coinCtx.summary}` : ""}`,
    btc,
    coinCtx,
  };
}
