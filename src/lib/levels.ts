import type { IndicatorSnapshot, SignalBias, BuyTimingAction, BuyZone } from "./types";
import { inferBuyTiming } from "./alerts";
import type { EntryMode } from "./user-types";

function fmtPx(px: number): string {
  if (px >= 1000) return px.toFixed(0);
  if (px >= 10) return px.toFixed(2);
  if (px >= 1) return px.toFixed(3);
  return px.toFixed(5);
}

/**
 * Zone d’achat cohérente avec tendance + prix actuel.
 */
export function computeBuyZone(
  coin: string,
  ind: IndicatorSnapshot,
  bias: SignalBias,
  score: number,
): BuyZone {
  const price = ind.price;
  const atr = ind.atr14 && ind.atr14 > 0 ? ind.atr14 : price * 0.015;

  const anchors = [
    ind.bbLower,
    ind.support,
    ind.ema20 !== null ? ind.ema20 : null,
    ind.ema50 !== null ? ind.ema50 : null,
    ind.bbMiddle !== null ? ind.bbMiddle - atr * 0.2 : null,
    price - atr * 0.8,
  ]
    .filter((v): v is number => v !== null && Number.isFinite(v) && v > 0)
    .filter((v) => v <= price * 1.001);

  const under = anchors.filter((v) => v <= price - atr * 0.15);
  let low = under.length
    ? Math.max(...under)
    : anchors.length
      ? Math.min(...anchors)
      : price - atr * 1.2;

  if (bias === "haussier" && ind.ema20 !== null && ind.ema20 < price) {
    low = Math.min(low, ind.ema20 - atr * 0.15);
    low = Math.max(low, price - atr * 2.5);
  }

  if (bias === "baissier" || score <= -3) {
    low = Math.min(low, (ind.support ?? price) - atr * 0.6, price - atr * 1.5);
  }

  if (!Number.isFinite(low) || low <= 0) low = price * 0.97;
  if (low >= price) low = price - atr * 0.5;

  let high = Math.min(price * 0.998, low + atr * 0.85, ind.ema20 ?? low + atr * 0.7);
  if (high <= low) high = Math.min(price * 0.999, low + atr * 0.4);
  if (high > price) high = price * 0.998;

  const mid = (low + high) / 2;
  const distPct = price > 0 ? ((price - mid) / price) * 100 : 0;

  let buyTiming = inferBuyTiming({
    bias,
    score,
    rsi: ind.rsi14,
    macdHist: ind.macdHist,
    price,
    support: ind.support,
    bbLower: ind.bbLower,
  });

  if (bias === "baissier" && score <= -3) {
    buyTiming = {
      action: "eviter" as BuyTimingAction,
      confidence: Math.min(buyTiming.confidence, 40),
      reason:
        "Tendance baissière : pas de zone d’achat prioritaire — plutôt attendre un support plus bas ou un short.",
      levels: `Surveiller ${fmtPx(low)} seulement si stabilisation RSI/MACD.`,
    };
  } else if (distPct > 6) {
    buyTiming = {
      ...buyTiming,
      action: buyTiming.action === "acheter_zone" ? "surveiller_achat" : buyTiming.action,
      reason: `Prix trop loin de la zone (${distPct.toFixed(1)} %) — attendre le pullback.`,
    };
  }

  let quality = buyTiming.confidence;
  if (bias === "baissier") quality = Math.min(quality, 35);
  if (distPct > 5) quality = Math.max(15, quality - 20);
  if (ind.ema200 !== null && price < ind.ema200 && bias !== "haussier") {
    quality = Math.min(quality, 40);
  }

  const invalidation = Math.min(low - atr * 0.5, (ind.support ?? low) - atr * 0.3);

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
    summary: `Zone ${fmtPx(low)}–${fmtPx(high)} (prix ${fmtPx(price)}, dist ${distPct.toFixed(1)} %, ${buyTiming.action.replaceAll("_", " ")}, q=${quality}/100). Inv. ~ ${fmtPx(invalidation)}.`,
  };
}

export interface TradeLevels {
  entry: number;
  idealEntry: number;
  tp: number;
  sl: number;
  entryMode: EntryMode;
  entryHint: string;
  riskReward: number;
  distanceToIdealPct: number;
}

/**
 * Entrée réaliste :
 * - conf ≥ 62 → market_now au prix actuel
 * - sinon limite (pullback long / bounce short)
 */
export function computeTradeLevels(
  side: "long" | "short",
  price: number,
  ind: IndicatorSnapshot,
  confidence = 60,
): TradeLevels {
  const atr = ind.atr14 && ind.atr14 > 0 ? ind.atr14 : price * 0.015;
  const preferMarket = confidence >= 62;

  if (side === "long") {
    const pullback = Math.min(
      price,
      ind.ema20 ?? price,
      (ind.bbMiddle ?? price) * 0.998,
      price - atr * 0.35,
    );
    const idealEntry = Math.min(pullback, price);
    const distPct = price > 0 ? ((price - idealEntry) / price) * 100 : 0;
    const useMarket = preferMarket || distPct < 0.35;
    const entry = useMarket ? price : idealEntry;
    const tp = entry + atr * 2.0;
    const sl = Math.min(entry - atr * 1.0, (ind.support ?? entry) - atr * 0.25);
    const risk = Math.abs(entry - sl) || atr;
    const reward = Math.abs(tp - entry);
    return {
      entry,
      idealEntry,
      tp,
      sl,
      entryMode: useMarket ? "market_now" : "limit_wait",
      entryHint: useMarket
        ? `Entrer MAINTENANT au marché (~${fmtPx(price)}). Limite idéale optionnelle ~${fmtPx(idealEntry)} si tu préfères un meilleur prix.`
        : `Placer une LIMITE d’achat ~${fmtPx(idealEntry)} (sous le spot ${fmtPx(price)}). Ne force pas l’entrée tant que ce niveau n’est pas touché.`,
      riskReward: reward / risk,
      distanceToIdealPct: distPct,
    };
  }

  const bounce = Math.max(
    price,
    ind.ema20 ?? price,
    (ind.bbMiddle ?? price) * 1.002,
    price + atr * 0.35,
  );
  const idealEntry = Math.max(bounce, price);
  const distPct = price > 0 ? ((idealEntry - price) / price) * 100 : 0;
  const useMarket = preferMarket || distPct < 0.35;
  const entry = useMarket ? price : idealEntry;
  const tp = entry - atr * 2.0;
  const sl = Math.max(entry + atr * 1.0, (ind.resistance ?? entry) + atr * 0.25);
  const risk = Math.abs(sl - entry) || atr;
  const reward = Math.abs(entry - tp);
  return {
    entry,
    idealEntry,
    tp,
    sl,
    entryMode: useMarket ? "market_now" : "limit_wait",
    entryHint: useMarket
      ? `Entrer MAINTENANT au marché (~${fmtPx(price)}). Meilleure limite SHORT optionnelle plus haut ~${fmtPx(idealEntry)}.`
      : `Placer une LIMITE de vente short ~${fmtPx(idealEntry)} (au-dessus du spot ${fmtPx(price)}). Attendre le bounce — pas d’entrée forcée.`,
    riskReward: reward / risk,
    distanceToIdealPct: distPct,
  };
}
