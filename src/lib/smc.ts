/**
 * Smart Money Concepts (SMC) — analyse top-down + checklist d’entrée.
 * Utilisé par le portefeuille « Boriaz ».
 */
import type { Candle, SignalBias } from "./types";
import { isShortAllowed } from "./live-side-policy";

export type SmcSide = "long" | "short";
export type SmcTrend = "haussier" | "baissier" | "neutre";
export type SmcStatus =
  | "ORDRE PRÊT À ÊTRE EXÉCUTÉ"
  | "EN ATTENTE DE RETRACEMENT"
  | "ANNULÉ";

export interface SwingPoint {
  index: number;
  price: number;
  kind: "high" | "low";
  time: number;
}

export interface FairValueGap {
  high: number;
  low: number;
  mid: number;
  direction: SmcSide;
  index: number;
}

export interface OteZone {
  high: number;
  low: number;
  ideal: number;
  impulseHigh: number;
  impulseLow: number;
}

export interface SmcRiskPlan {
  walletEur: number;
  riskPct: number;
  riskEur: number;
  slDistancePct: number;
  notionalEur: number;
  leverage: number;
  marginEur: number;
  sizePct: number;
}

export interface SmcOrderParams {
  side: SmcSide;
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  entryMode: "limit_wait" | "market_now";
  /** deep = ÔTE 0.618–0.786 ; shallow = retest BOS 0.5–0.618 */
  entryStyle?: "deep" | "shallow";
}

export interface SmcChecklist {
  mtfAligned: boolean;
  h1Aligned: boolean;
  liquiditySweep: boolean;
  chochBos: boolean;
  fvg: boolean;
  ote: boolean;
  allPass: boolean;
}

export interface SmcTfBias {
  d1: SmcTrend;
  h4: SmcTrend;
  h1: SmcTrend;
  exec: SmcTrend;
}

export interface SmcSetup {
  coin: string;
  side: SmcSide | null;
  bias: SmcTfBias;
  checklist: SmcChecklist;
  liquidityLevel: number | null;
  fvg: FairValueGap | null;
  ote: OteZone | null;
  order: SmcOrderParams | null;
  risk: SmcRiskPlan | null;
  status: SmcStatus;
  cancelReason: string | null;
  confidence: number;
  report: string;
  price: number;
  /** TF d’exécution utilisée (M5 / M15 / M30). */
  execTimeframe?: "5m" | "15m" | "30m" | null;
  /**
   * Continuation = aligné D1/H4.
   * Correction = retracement (SHORT si D1 haussier / LONG si D1 baissier).
   */
  signalType?:
    | "long_aligned"
    | "short_aligned"
    | "long_counter_trend"
    | "short_counter_trend"
    | null;
  /** true = trade de correction / retracement. */
  counterTrend?: boolean;
  /** continuation | correction */
  tradeKind?: "continuation" | "correction" | null;
  /** deep ÔTE vs shallow retest BOS (demi-taille). */
  entryStyle?: "deep" | "shallow" | null;
  /** true = D1 neutre, H4 mène (taille réduite). */
  h4Lead?: boolean;
}

const EQUAL_TOL = 0.002; // 0.20 % equal highs/lows
const SWEEP_WICK_RATIO = 0.28;

function trendFromStructure(candles: Candle[], lookback = 40): SmcTrend {
  if (candles.length < 10) return "neutre";
  const swings = findSwings(candles, 2);
  const highs = swings.filter((s) => s.kind === "high").slice(-4);
  const lows = swings.filter((s) => s.kind === "low").slice(-4);
  if (highs.length < 2 || lows.length < 2) {
    // Fallback EMA-like : close vs mid-range
    const slice = candles.slice(-lookback);
    const first = slice[0]!.c;
    const last = slice.at(-1)!.c;
    const change = (last - first) / first;
    if (change > 0.012) return "haussier";
    if (change < -0.012) return "baissier";
    return "neutre";
  }
  const hh = highs.at(-1)!.price > highs.at(-2)!.price;
  const hl = lows.at(-1)!.price > lows.at(-2)!.price;
  const lh = highs.at(-1)!.price < highs.at(-2)!.price;
  const ll = lows.at(-1)!.price < lows.at(-2)!.price;
  if (hh && hl) return "haussier";
  if (lh && ll) return "baissier";
  if (hh && !ll) return "haussier";
  if (ll && !hh) return "baissier";
  return "neutre";
}

export function findSwings(candles: Candle[], leftRight = 2): SwingPoint[] {
  const out: SwingPoint[] = [];
  for (let i = leftRight; i < candles.length - leftRight; i++) {
    const c = candles[i]!;
    let isHigh = true;
    let isLow = true;
    for (let j = i - leftRight; j <= i + leftRight; j++) {
      if (j === i) continue;
      if (candles[j]!.h >= c.h) isHigh = false;
      if (candles[j]!.l <= c.l) isLow = false;
    }
    if (isHigh) {
      out.push({ index: i, price: c.h, kind: "high", time: c.t });
    } else if (isLow) {
      out.push({ index: i, price: c.l, kind: "low", time: c.t });
    }
  }
  return out;
}

export function detectLiquiditySweep(
  candles: Candle[],
  side: SmcSide,
): { ok: boolean; level: number | null } {
  if (candles.length < 20) return { ok: false, level: null };
  const swings = findSwings(candles, 2);
  // Fenêtre élargie (~6–8 h sur M15) — trop court = presque jamais de sweep
  const recent = candles.slice(-32);
  if (side === "long") {
    const lows = swings.filter((s) => s.kind === "low").slice(-8);
    for (const sw of lows) {
      for (const c of recent) {
        const sweptBelow = c.l < sw.price * (1 - EQUAL_TOL * 0.25);
        const closedBack = c.c > sw.price * 0.998;
        const body = Math.abs(c.c - c.o);
        const range = c.h - c.l || 1e-9;
        if (sweptBelow && closedBack && body / range >= SWEEP_WICK_RATIO * 0.35) {
          return { ok: true, level: sw.price };
        }
      }
    }
    for (let i = 0; i < lows.length - 1; i++) {
      const a = lows[i]!;
      const b = lows[i + 1]!;
      if (Math.abs(a.price - b.price) / a.price <= EQUAL_TOL) {
        const last = recent.at(-1)!;
        const lvl = Math.min(a.price, b.price);
        if (last.l < lvl && last.c > lvl * 0.997) {
          return { ok: true, level: lvl };
        }
      }
    }
  } else {
    const highs = swings.filter((s) => s.kind === "high").slice(-8);
    for (const sw of highs) {
      for (const c of recent) {
        const sweptAbove = c.h > sw.price * (1 + EQUAL_TOL * 0.25);
        const closedBack = c.c < sw.price * 1.002;
        const body = Math.abs(c.c - c.o);
        const range = c.h - c.l || 1e-9;
        if (sweptAbove && closedBack && body / range >= SWEEP_WICK_RATIO * 0.35) {
          return { ok: true, level: sw.price };
        }
      }
    }
    for (let i = 0; i < highs.length - 1; i++) {
      const a = highs[i]!;
      const b = highs[i + 1]!;
      if (Math.abs(a.price - b.price) / a.price <= EQUAL_TOL) {
        const last = recent.at(-1)!;
        const lvl = Math.max(a.price, b.price);
        if (last.h > lvl && last.c < lvl * 1.003) {
          return { ok: true, level: lvl };
        }
      }
    }
  }
  return { ok: false, level: null };
}

/**
 * CHoCH + BOS confirmés par CLÔTURE DE CORPS (pas une mèche seule).
 * LONG : break au-dessus d’un swing high après un sweep bas.
 * SHORT : break sous un swing low après un sweep haut.
 * Zéro tolérance : sans clôture de corps au-delà du niveau → rejet.
 */
export function detectChochBos(
  candles: Candle[],
  side: SmcSide,
): { ok: boolean; bosLevel: number | null; impulseHigh: number; impulseLow: number } {
  const swings = findSwings(candles, 2);
  if (candles.length < 15 || swings.length < 3) {
    return { ok: false, bosLevel: null, impulseHigh: 0, impulseLow: 0 };
  }
  const window = candles.slice(-24);

  if (side === "long") {
    const highs = swings.filter((s) => s.kind === "high").slice(-6);
    const lows = swings.filter((s) => s.kind === "low").slice(-6);
    const bosTarget = highs.at(-2) ?? highs.at(-1);
    const swingLow = lows.at(-1);
    if (!bosTarget || !swingLow) {
      return { ok: false, bosLevel: null, impulseHigh: 0, impulseLow: 0 };
    }
    // Corps clôture AU-DESSUS du niveau (open/close min > level pour bougie bull,
    // ou close > level pour bougie quelconque — on exige close > level)
    const bodyClosedBeyond = window.some((c) => {
      const bodyHigh = Math.max(c.o, c.c);
      return c.c > bosTarget.price && bodyHigh > bosTarget.price;
    });
    const impulseHigh = Math.max(...window.map((c) => c.h));
    const impulseLow = Math.min(
      swingLow.price,
      Math.min(...window.slice(-8).map((c) => c.l)),
    );
    return {
      ok: bodyClosedBeyond,
      bosLevel: bosTarget.price,
      impulseHigh,
      impulseLow,
    };
  }

  const highs = swings.filter((s) => s.kind === "high").slice(-6);
  const lows = swings.filter((s) => s.kind === "low").slice(-6);
  const bosTarget = lows.at(-2) ?? lows.at(-1);
  const swingHigh = highs.at(-1);
  if (!bosTarget || !swingHigh) {
    return { ok: false, bosLevel: null, impulseHigh: 0, impulseLow: 0 };
  }
  const bodyClosedBeyond = window.some((c) => {
    const bodyLow = Math.min(c.o, c.c);
    return c.c < bosTarget.price && bodyLow < bosTarget.price;
  });
  const impulseLow = Math.min(...window.map((c) => c.l));
  const impulseHigh = Math.max(
    swingHigh.price,
    Math.max(...window.slice(-8).map((c) => c.h)),
  );
  return {
    ok: bodyClosedBeyond,
    bosLevel: bosTarget.price,
    impulseHigh,
    impulseLow,
  };
}

/** Buffer « 1–2 pips » crypto (échelle selon le prix). */
export function smcPipBuffer(price: number): number {
  if (!(price > 0)) return 0.0001;
  if (price >= 10_000) return Math.max(2, price * 0.00015); // ~1.5–2$ BTC
  if (price >= 1000) return Math.max(0.5, price * 0.0002);
  if (price >= 10) return Math.max(0.02, price * 0.00025);
  if (price >= 1) return Math.max(0.002, price * 0.0003);
  return Math.max(price * 0.0004, 1e-6);
}

/**
 * Liquidité opposée majeure (Equal Highs/Lows) pour TP2 structurel.
 * LONG → equal highs / sell-side liq au-dessus.
 * SHORT → equal lows / buy-side liq en-dessous.
 */
export function findOppositeLiquidity(
  candles: Candle[],
  side: SmcSide,
  entry: number,
  minRrDist: number,
): number | null {
  const swings = findSwings(candles, 2);
  if (side === "long") {
    const highs = swings.filter((s) => s.kind === "high" && s.price > entry + minRrDist);
    // Equal highs
    for (let i = highs.length - 1; i >= 1; i--) {
      const a = highs[i]!;
      const b = highs[i - 1]!;
      if (Math.abs(a.price - b.price) / a.price <= EQUAL_TOL) {
        const lvl = Math.max(a.price, b.price);
        if (lvl >= entry + minRrDist) return lvl;
      }
    }
    const last = highs.at(-1);
    if (last && last.price >= entry + minRrDist) return last.price;
    return null;
  }
  const lows = swings.filter((s) => s.kind === "low" && s.price < entry - minRrDist);
  for (let i = lows.length - 1; i >= 1; i--) {
    const a = lows[i]!;
    const b = lows[i - 1]!;
    if (Math.abs(a.price - b.price) / a.price <= EQUAL_TOL) {
      const lvl = Math.min(a.price, b.price);
      if (lvl <= entry - minRrDist) return lvl;
    }
  }
  const last = lows.at(-1);
  if (last && last.price <= entry - minRrDist) return last.price;
  return null;
}

/** FVG adverse non comblé utilisable comme TP2. */
export function findOppositeFvgTarget(
  candles: Candle[],
  side: SmcSide,
  entry: number,
  minRrDist: number,
): number | null {
  const opp: SmcSide = side === "long" ? "short" : "long";
  const fvg = detectFvg(candles, opp);
  if (!fvg) return null;
  if (side === "long") {
    const tgt = fvg.low;
    return tgt >= entry + minRrDist ? tgt : null;
  }
  const tgt = fvg.high;
  return tgt <= entry - minRrDist ? tgt : null;
}

export function detectFvg(
  candles: Candle[],
  side: SmcSide,
): FairValueGap | null {
  // FVG 3-bougies : gap entre bougie i-2 et i
  for (let i = candles.length - 1; i >= Math.max(2, candles.length - 24); i--) {
    const c0 = candles[i - 2]!;
    const c2 = candles[i]!;
    if (side === "long") {
      // Bullish FVG : low of candle 3 > high of candle 1
      if (c2.l > c0.h) {
        return {
          high: c2.l,
          low: c0.h,
          mid: (c2.l + c0.h) / 2,
          direction: "long",
          index: i,
        };
      }
    } else if (c2.h < c0.l) {
      return {
        high: c0.l,
        low: c2.h,
        mid: (c0.l + c2.h) / 2,
        direction: "short",
        index: i,
      };
    }
  }
  return null;
}

/** Zone ÔTE Fibonacci 0.618–0.786 (idéal 0.705) sur l’impulsion BOS. */
export function computeOte(
  side: SmcSide,
  impulseHigh: number,
  impulseLow: number,
): OteZone | null {
  if (!(impulseHigh > impulseLow) || impulseLow <= 0) return null;
  const range = impulseHigh - impulseLow;
  if (side === "long") {
    // Retracement depuis le haut de l’impulsion
    const low = impulseHigh - range * 0.786;
    const high = impulseHigh - range * 0.618;
    const ideal = impulseHigh - range * 0.705;
    return { high, low, ideal, impulseHigh, impulseLow };
  }
  const low = impulseLow + range * 0.618;
  const high = impulseLow + range * 0.786;
  const ideal = impulseLow + range * 0.705;
  return { high, low, ideal, impulseHigh, impulseLow };
}

/**
 * Retest BOS shallow 0.5–0.618 — pour continuations qui ne taguent jamais le deep ÔTE.
 * Demi-taille côté sizing (riskPct × 0.5).
 */
export function computeOteShallow(
  side: SmcSide,
  impulseHigh: number,
  impulseLow: number,
): OteZone | null {
  if (!(impulseHigh > impulseLow) || impulseLow <= 0) return null;
  const range = impulseHigh - impulseLow;
  if (side === "long") {
    const low = impulseHigh - range * 0.618;
    const high = impulseHigh - range * 0.5;
    const ideal = impulseHigh - range * 0.56;
    return { high, low, ideal, impulseHigh, impulseLow };
  }
  const low = impulseLow + range * 0.5;
  const high = impulseLow + range * 0.618;
  const ideal = impulseLow + range * 0.56;
  return { high, low, ideal, impulseHigh, impulseLow };
}

/**
 * Distance SL minimale vs entry — sinon le bruit (surtout alts) stop-out
 * avant que le trade respire. Majors plus serrés OK.
 */
export function minSlDistancePct(entry: number): number {
  if (!(entry > 0)) return 0.01;
  if (entry < 1) return 0.012; // alts type DOGE : ≥1.2%
  if (entry < 50) return 0.008;
  return 0.005; // BTC/ETH ~0.5%
}

/** Élargit le SL si trop collé à l’entry ; recalcule TP1=1R et TP2≥2R. */
export function enforceMinSlBreathingRoom(input: {
  side: SmcSide;
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
}): { sl: number; tp1: number; tp2: number; widened: boolean } {
  const { side, entry } = input;
  let { sl, tp1, tp2 } = input;
  const minPct = minSlDistancePct(entry);
  const risk = side === "long" ? entry - sl : sl - entry;
  const minRisk = entry * minPct;
  if (!(risk > 0) || risk >= minRisk * 0.999) {
    return { sl, tp1, tp2, widened: false };
  }
  if (side === "long") {
    sl = entry - minRisk;
    tp1 = entry + minRisk;
    tp2 = Math.max(tp2, entry + minRisk * 2);
  } else {
    sl = entry + minRisk;
    tp1 = entry - minRisk;
    tp2 = Math.min(tp2, entry - minRisk * 2);
  }
  return { sl, tp1, tp2, widened: true };
}

/**
 * Fraction clôturée au TP1 (1R). Le reste court vers TP2 (≥2R).
 * 20% lock + 80% runner → viser ~100$ sur compte ~950$ quand risque ~8–10%.
 */
export const SMC_TP1_CLOSE_FRAC = 0.2;

/**
 * Risque % selon confiance — **prudent** : survivre > maximiser une nuit.
 * Cap **4%** du wallet (plus 10%). Trade sûr ≠ all-in.
 * 4% × ~1.8R effectif ≈ 65–70$ sur 900$ — assez pour être positif sans se vider.
 */
export function riskPctFromConfidence(
  confidence: number,
  baseRiskPct = 2.5,
): number {
  const base = Math.min(4, Math.max(1.5, baseRiskPct));
  if (confidence >= 90) return Math.min(4, Math.max(base, 4));
  if (confidence >= 84) return Math.min(4, Math.max(base, 3.5));
  if (confidence >= 78) return Math.min(4, Math.max(base, 3));
  if (confidence >= 72) return Math.min(4, Math.max(base, 2.5));
  return Math.min(4, Math.max(base, 2));
}

export function computeSmcRiskPlan(input: {
  walletEur: number;
  entry: number;
  sl: number;
  maxLeverage: number;
  riskPct?: number;
}): SmcRiskPlan {
  const riskPct = input.riskPct ?? 3;
  const walletEur = Math.max(100, input.walletEur);
  let riskEur = walletEur * (riskPct / 100);
  const slDistancePct =
    input.entry > 0
      ? (Math.abs(input.entry - input.sl) / input.entry) * 100
      : 1;
  const dist = Math.max(0.15, slDistancePct) / 100;
  let notionalEur = riskEur / dist;
  // Levier : assez pour porter le notionnel (jusqu’à maxLev — 5× Boriaz)
  let leverage = Math.min(
    input.maxLeverage,
    Math.max(1, Math.ceil(notionalEur / (walletEur * 0.2))),
  );
  leverage = Math.min(input.maxLeverage, Math.max(1, leverage));
  // Cap marge : ne pas engager plus de ~90% du wallet
  const maxNotional = walletEur * leverage * 0.9;
  if (notionalEur > maxNotional) {
    notionalEur = maxNotional;
    riskEur = notionalEur * dist;
  }
  const marginEur = notionalEur / leverage;
  const sizePct = Math.min(40, Math.max(0.5, (marginEur / walletEur) * 100));
  return {
    walletEur,
    riskPct,
    riskEur: Math.round(riskEur * 100) / 100,
    slDistancePct: Math.round(slDistancePct * 100) / 100,
    notionalEur: Math.round(notionalEur * 100) / 100,
    leverage,
    marginEur: Math.round(marginEur * 100) / 100,
    sizePct: Math.round(sizePct * 100) / 100,
  };
}

export function buildSmcOrder(input: {
  side: SmcSide;
  price: number;
  ote: OteZone;
  fvg: FairValueGap | null;
  impulseHigh: number;
  impulseLow: number;
  /** Niveau exact du sweep (mèche) — SL 1–2 pips au-delà. */
  sweepLevel?: number | null;
  /** Bougies exec pour TP2 structurel (liquidité opposée / FVG). */
  candlesExec?: Candle[];
  entryStyle?: "deep" | "shallow";
}): SmcOrderParams {
  const { side, ote, fvg, impulseHigh, impulseLow } = input;
  void input.price;
  let entry = ote.ideal;
  // Confluence FVG ∩ ÔTE — entrée LIMIT exclusive dans la zone
  if (fvg) {
    const overlapLow = Math.max(ote.low, fvg.low);
    const overlapHigh = Math.min(ote.high, fvg.high);
    if (overlapHigh > overlapLow) {
      entry = (overlapLow + overlapHigh) / 2;
    } else {
      // Pas d’overlap : rester dans ÔTE (idéal), FVG doit quand même exister
      entry = ote.ideal;
    }
  }

  const pip = smcPipBuffer(entry);
  const sweep =
    input.sweepLevel != null && input.sweepLevel > 0 ? input.sweepLevel : null;
  let sl: number;
  let tp1: number;
  let tp2: number;

  if (side === "long") {
    const wickLow = sweep != null ? Math.min(sweep, impulseLow) : impulseLow;
    sl = wickLow - pip; // 1–2 pips sous la mèche
    const risk = entry - sl;
    tp1 = entry + risk; // R:R exact 1:1
    const min2r = risk * 2;
    const structural =
      (input.candlesExec
        ? findOppositeLiquidity(input.candlesExec, "long", entry, min2r)
        : null) ??
      (input.candlesExec
        ? findOppositeFvgTarget(input.candlesExec, "long", entry, min2r)
        : null);
    tp2 = structural != null && structural >= entry + min2r
      ? structural
      : entry + min2r;
  } else {
    const wickHigh =
      sweep != null ? Math.max(sweep, impulseHigh) : impulseHigh;
    sl = wickHigh + pip; // 1–2 pips au-dessus de la mèche
    const risk = sl - entry;
    tp1 = entry - risk;
    const min2r = risk * 2;
    const structural =
      (input.candlesExec
        ? findOppositeLiquidity(input.candlesExec, "short", entry, min2r)
        : null) ??
      (input.candlesExec
        ? findOppositeFvgTarget(input.candlesExec, "short", entry, min2r)
        : null);
    tp2 = structural != null && structural <= entry - min2r
      ? structural
      : entry - min2r;
  }

  // Anti noise-stop : SL trop collé → élargir + recalculer 1R/2R
  const room = enforceMinSlBreathingRoom({ side, entry, sl, tp1, tp2 });
  sl = room.sl;
  tp1 = room.tp1;
  tp2 = room.tp2;

  // Ultra-strict : LIMIT exclusively dans ÔTE/FVG — jamais market
  return {
    side,
    entry,
    sl,
    tp1,
    tp2,
    entryMode: "limit_wait",
    entryStyle: input.entryStyle ?? "deep",
  };
}

function fmt(px: number): string {
  if (px >= 1000) return px.toFixed(2);
  if (px >= 10) return px.toFixed(4);
  if (px >= 1) return px.toFixed(5);
  return px.toFixed(6);
}

export function formatSmcReport(setup: SmcSetup): string {
  const b = setup.bias;
  const c = setup.checklist;
  const execLabel =
    setup.execTimeframe === "5m"
      ? "M5"
      : setup.execTimeframe === "30m"
        ? "M30"
        : "M15";
  const signalLabel =
    setup.signalType === "long_aligned"
      ? "LONG Continuation (D1/H4)"
      : setup.signalType === "short_aligned"
        ? "SHORT Continuation (D1/H4)"
        : setup.signalType === "short_counter_trend"
          ? "SHORT Correction (retracement)"
          : setup.signalType === "long_counter_trend"
            ? "LONG Correction (retracement)"
            : setup.side
              ? setup.side.toUpperCase()
              : "—";
  const d1Label =
    b.d1 === "haussier" ? "Haussière" : b.d1 === "baissier" ? "Baissière" : "Neutre";
  const h4Label =
    b.h4 === "haussier" ? "Haussière" : b.h4 === "baissier" ? "Baissière" : "Neutre";

  const missing: string[] = [];
  if (!c.liquiditySweep) missing.push("Liquidity Sweep");
  if (!c.chochBos) missing.push("CHoCH/BOS (clôture corps)");
  if (!c.fvg) missing.push("FVG");
  if (!c.ote) missing.push("Zone ÔTE");

  if (!c.allPass || !setup.order || !setup.risk) {
    return [
      "[ANALYSE TIMEFRAME]",
      "",
      `Tendance Daily (D1) / H4 : ${d1Label} / ${h4Label}`,
      `Timeframe d'Exécution : ${execLabel}`,
      `Type de Signal : ${signalLabel}`,
      "",
      "",
      `[CHECKLIST SMC ULTRA-STRICTE (${execLabel})]`,
      "",
      `Liquidity Sweep : ${c.liquiditySweep ? `VALIDE (${setup.liquidityLevel != null ? fmt(setup.liquidityLevel) : "niveau local"})` : "✗ NON VALIDE"}`,
      `CHoCH / BOS (clôture corps) : ${c.chochBos ? "VALIDE" : "✗ NON VALIDE"}`,
      `FVG identifié : ${c.fvg && setup.fvg ? `VALIDE (${fmt(setup.fvg.low)} – ${fmt(setup.fvg.high)})` : "✗ NON VALIDE"}`,
      `Zone ÔTE (0.618 - 0.786) : ${c.ote && setup.ote ? `VALIDE (${fmt(setup.ote.low)} – ${fmt(setup.ote.high)})` : "✗ NON VALIDE"}`,
      "",
      missing.length
        ? `Critère(s) manquant(s) : ${missing.join(", ")}`
        : "Setup incomplet / TF non autorisée",
      "",
      "",
      "SETUP INVALIDÉ (CRITÈRE MANQUANT) - AUCUN ORDRE",
      "",
      "Statut : ANNULÉ",
    ].join("\n");
  }

  const lines = [
    "[ANALYSE TIMEFRAME]",
    "",
    `Tendance Daily (D1) / H4 : ${d1Label} / ${h4Label}`,
    `Timeframe d'Exécution : ${execLabel}`,
    `Type de Signal : ${signalLabel}`,
    `Kind : ${setup.tradeKind === "correction" ? "Correction / Retracement" : "Continuation"}`,
    "",
    "",
    `[CHECKLIST SMC ULTRA-STRICTE (${execLabel})]`,
    "",
    `Liquidity Sweep : VALIDE (${setup.liquidityLevel != null ? fmt(setup.liquidityLevel) : "niveau local"})`,
    "CHoCH / BOS (clôture corps) : VALIDE",
    `FVG identifié : VALIDE (${fmt(setup.fvg!.low)} – ${fmt(setup.fvg!.high)})`,
    `Zone ÔTE (0.618 - 0.786) : VALIDE (${fmt(setup.ote!.low)} – ${fmt(setup.ote!.high)})`,
    "",
    "",
    "[RÈGLES DE RISQUE & SIZING]",
    "",
    `Capital Risqué (${setup.risk.riskPct}%) : ${setup.risk.riskEur.toFixed(2)} $`,
    `Distance SL (%) : ${setup.risk.slDistancePct.toFixed(2)}%`,
    `Taille de la position : ${setup.risk.notionalEur.toLocaleString("fr-FR")} $`,
    "",
    "",
    "[PARAMÈTRES DE L'ORDRE]",
    "",
    `Type d'ordre : LIMIT ${setup.order.side.toUpperCase()}`,
    `Prix d'entrée (Entry) : ${fmt(setup.order.entry)}`,
    `Stop Loss Initial (SL) : ${fmt(setup.order.sl)} (1–2 pips au-delà mèche sweep)`,
    `TP1 (R:R 1:1 - Clôture ${Math.round(SMC_TP1_CLOSE_FRAC * 100)}%, runner vers TP2) : ${fmt(setup.order.tp1)}`,
    `TP2 Structurel (liq. opposée / FVG, ≥2R) : ${fmt(setup.order.tp2)}`,
    "",
    "",
    `Statut : ${
      setup.status === "ANNULÉ" && setup.cancelReason
        ? `ANNULÉ - ${setup.cancelReason}`
        : setup.status
    }`,
  ];
  return lines.join("\n");
}

function evaluateSideOnExec(input: {
  side: SmcSide;
  candlesExec: Candle[];
  price: number;
  walletEur: number;
  maxLeverage: number;
  riskPct?: number;
  entryStyle?: "deep" | "shallow";
}): {
  liquiditySweep: boolean;
  liquidityLevel: number | null;
  chochBos: boolean;
  fvg: FairValueGap | null;
  ote: OteZone | null;
  order: SmcOrderParams | null;
  risk: SmcRiskPlan | null;
  impulseHigh: number;
  impulseLow: number;
  missing: string[];
  entryStyle: "deep" | "shallow";
} {
  const entryStyle = input.entryStyle ?? "deep";
  const liq = detectLiquiditySweep(input.candlesExec, input.side);
  const bos = detectChochBos(input.candlesExec, input.side);
  const impulseHigh = bos.impulseHigh;
  const impulseLow = bos.impulseLow;
  // FVG de l'impulsion BOS uniquement — zéro fallback soft
  const fvg = bos.ok ? detectFvg(input.candlesExec, input.side) : null;

  let ote: OteZone | null = null;
  if (bos.ok && impulseHigh > impulseLow) {
    ote =
      entryStyle === "shallow"
        ? computeOteShallow(input.side, impulseHigh, impulseLow)
        : computeOte(input.side, impulseHigh, impulseLow);
  }

  const missing: string[] = [];
  if (!liq.ok) missing.push("Liquidity Sweep");
  if (!bos.ok) missing.push("CHoCH/BOS (clôture corps)");
  if (!fvg) missing.push("FVG");
  if (!ote) missing.push(entryStyle === "shallow" ? "Zone shallow 0.5–0.618" : "Zone ÔTE");

  let order: SmcOrderParams | null = null;
  let risk: SmcRiskPlan | null = null;
  if (liq.ok && bos.ok && fvg && ote) {
    order = buildSmcOrder({
      side: input.side,
      price: input.price,
      ote,
      fvg,
      impulseHigh,
      impulseLow,
      sweepLevel: liq.level,
      candlesExec: input.candlesExec,
      entryStyle,
    });
    const baseRisk = input.riskPct ?? 3;
    // Shallow = demi-taille (capture trend sans oversize)
    const riskPct =
      entryStyle === "shallow" ? Math.max(1.5, baseRisk * 0.5) : baseRisk;
    risk = computeSmcRiskPlan({
      walletEur: input.walletEur,
      entry: order.entry,
      sl: order.sl,
      maxLeverage: input.maxLeverage,
      riskPct,
    });
  }

  return {
    liquiditySweep: liq.ok,
    liquidityLevel: liq.level,
    chochBos: bos.ok,
    fvg,
    ote,
    order,
    risk,
    impulseHigh,
    impulseLow,
    missing,
    entryStyle,
  };
}

export function analyzeSmcSetup(input: {
  coin: string;
  price: number;
  candlesD1: Candle[];
  candlesH4: Candle[];
  candlesH1: Candle[];
  candlesExec: Candle[];
  walletEur: number;
  maxLeverage?: number;
  execTimeframe?: "5m" | "15m" | "30m";
}): SmcSetup {
  const d1 = trendFromStructure(input.candlesD1, 60);
  const h4 = trendFromStructure(input.candlesH4, 40);
  const h1 = trendFromStructure(input.candlesH1, 40);
  const exec = trendFromStructure(input.candlesExec, 30);
  const maxLev = input.maxLeverage ?? 8;
  const execTf = input.execTimeframe ?? "15m";

  const longContinuation = d1 === "haussier" && h4 === "haussier";
  const shortContinuation = d1 === "baissier" && h4 === "baissier";
  // H4-lead : D1 neutre mais H4+H1 alignés — early trend, demi-taille
  const longH4Lead =
    d1 === "neutre" && h4 === "haussier" && h1 !== "baissier" && !longContinuation;
  // shortH4Lead / shortCorrection : volontairement non utilisés (shorts = continuation deep only)
  const correctionTfOk = execTf === "15m" || execTf === "30m";
  const longCorrection = d1 === "baissier" && correctionTfOk;

  type Candidate = {
    side: SmcSide;
    signalType: NonNullable<SmcSetup["signalType"]>;
    counterTrend: boolean;
    tradeKind: "continuation" | "correction";
    h4Lead: boolean;
    entryStyle: "deep" | "shallow";
    local: ReturnType<typeof evaluateSideOnExec>;
  };

  const candidates: Candidate[] = [];

  const pushCont = (
    side: SmcSide,
    signalType: NonNullable<SmcSetup["signalType"]>,
    h4Lead: boolean,
  ) => {
    const riskPct = h4Lead ? 2.5 : undefined;
    const deep = evaluateSideOnExec({
      side,
      candlesExec: input.candlesExec,
      price: input.price,
      walletEur: input.walletEur,
      maxLeverage: maxLev,
      riskPct,
      entryStyle: "deep",
    });
    const shallow = evaluateSideOnExec({
      side,
      candlesExec: input.candlesExec,
      price: input.price,
      walletEur: input.walletEur,
      maxLeverage: maxLev,
      riskPct: riskPct != null ? riskPct * 0.5 : 2,
      entryStyle: "shallow",
    });
    // Choisir le style le plus fillable : ORDRE PRÊT > zone la plus proche du prix
    const score = (loc: typeof deep, style: "deep" | "shallow") => {
      if (!loc.order || !loc.ote || !loc.risk) return -1;
      const zLo = Math.min(loc.ote.low, loc.fvg?.low ?? loc.ote.low);
      const zHi = Math.max(loc.ote.high, loc.fvg?.high ?? loc.ote.high);
      const inZone =
        input.price >= zLo * 0.994 && input.price <= zHi * 1.006;
      const dist = Math.min(
        Math.abs(input.price - loc.order.entry),
        Math.abs(input.price - loc.ote.ideal),
      );
      // Shallow bonus en continuation tendance (capture sans attendre deep)
      const styleBonus = style === "shallow" ? 0.15 : 0;
      return (inZone ? 1000 : 0) + styleBonus * 100 - dist / input.price;
    };
    const deepOk =
      deep.liquiditySweep &&
      deep.chochBos &&
      deep.fvg &&
      deep.ote &&
      deep.order &&
      deep.risk;
    const shallowOk =
      shallow.liquiditySweep &&
      shallow.chochBos &&
      shallow.fvg &&
      shallow.ote &&
      shallow.order &&
      shallow.risk;
    let pick: typeof deep | null = null;
    let style: "deep" | "shallow" = "deep";
    if (deepOk && shallowOk) {
      if (score(shallow, "shallow") > score(deep, "deep")) {
        pick = shallow;
        style = "shallow";
      } else {
        pick = deep;
        style = "deep";
      }
    } else if (shallowOk) {
      pick = shallow;
      style = "shallow";
    } else if (deepOk) {
      pick = deep;
      style = "deep";
    } else {
      pick = deep; // partial for report
      style = "deep";
    }
    candidates.push({
      side,
      signalType,
      counterTrend: false,
      tradeKind: "continuation",
      h4Lead,
      entryStyle: style,
      local: pick,
    });
  };

  if (longContinuation) {
    pushCont("long", "long_aligned", false);
  }
  const shortsOk = isShortAllowed();
  // Shorts : uniquement continuation D1+H4 baissier + deep ÔTE (sûr et certain)
  if (shortsOk && shortContinuation) {
    const deepShort = evaluateSideOnExec({
      side: "short",
      candlesExec: input.candlesExec,
      price: input.price,
      walletEur: input.walletEur,
      maxLeverage: maxLev,
      entryStyle: "deep",
    });
    candidates.push({
      side: "short",
      signalType: "short_aligned",
      counterTrend: false,
      tradeKind: "continuation",
      h4Lead: false,
      entryStyle: "deep",
      local: deepShort,
    });
  }
  if (longH4Lead) {
    pushCont("long", "long_aligned", true);
  }
  // shortH4Lead / shortCorrection / short shallow exclus — trop fragiles
  // Corrections LONG gardées (gate conf 88 + range)
  if (longCorrection && !longContinuation && !longH4Lead) {
    candidates.push({
      side: "long",
      signalType: "long_counter_trend",
      counterTrend: true,
      tradeKind: "correction",
      h4Lead: false,
      entryStyle: "deep",
      local: evaluateSideOnExec({
        side: "long",
        candlesExec: input.candlesExec,
        price: input.price,
        walletEur: input.walletEur,
        maxLeverage: maxLev,
      }),
    });
  }

  const complete = candidates
    .filter(
      (c) =>
        c.local.liquiditySweep &&
        c.local.chochBos &&
        c.local.fvg &&
        c.local.ote &&
        c.local.order &&
        c.local.risk,
    )
    .sort((a, b) => {
      const score = (c: Candidate) =>
        (c.tradeKind === "continuation" ? 4 : 0) +
        (c.h4Lead ? 1 : 0) +
        (c.entryStyle === "shallow" && c.tradeKind === "continuation" ? 1 : 0) +
        (c.signalType === "long_aligned" ? 3 : 0) +
        (c.signalType === "short_aligned" ? 2 : 0) +
        (c.signalType === "long_counter_trend" ||
        c.signalType === "short_counter_trend"
          ? 1
          : 0);
      return score(b) - score(a);
    });

  const best = complete[0] ?? null;
  const side = best?.side ?? null;
  const local = best?.local;
  const mtfAligned =
    best?.tradeKind === "continuation"
      ? true
      : best?.tradeKind === "correction"
        ? correctionTfOk
        : false;
  const h1Aligned =
    best?.tradeKind === "correction"
      ? true
      : best?.h4Lead
        ? h1 !== (side === "long" ? "baissier" : "haussier")
      : side === "long"
        ? h1 !== "baissier"
        : side === "short"
          ? h1 !== "haussier"
          : false;

  const checklist: SmcChecklist = {
    mtfAligned,
    h1Aligned,
    liquiditySweep: Boolean(local?.liquiditySweep),
    chochBos: Boolean(local?.chochBos),
    fvg: Boolean(local?.fvg),
    ote: Boolean(local?.ote),
    allPass: false,
  };
  checklist.allPass =
    Boolean(best) &&
    checklist.liquiditySweep &&
    checklist.chochBos &&
    checklist.fvg &&
    checklist.ote &&
    local?.order != null &&
    local?.risk != null;

  let status: SmcStatus = "ANNULÉ";
  let cancelReason: string | null =
    "SETUP INVALIDÉ (CRITÈRE MANQUANT) - AUCUN ORDRE";
  if (checklist.allPass && local?.order && local.ote && local.fvg) {
    const zoneLow = Math.min(local.ote.low, local.fvg.low);
    const zoneHigh = Math.max(local.ote.high, local.fvg.high);
    // Fenêtre ±0.6 % autour ÔTE∪FVG — assez pour filler, sans poursuite hors zone
    const inZone =
      input.price >= zoneLow * 0.994 && input.price <= zoneHigh * 1.006;
    status = inZone
      ? "ORDRE PRÊT À ÊTRE EXÉCUTÉ"
      : "EN ATTENTE DE RETRACEMENT";
    cancelReason = null;
  }

  let confidence = 35;
  if (checklist.mtfAligned) confidence += 8;
  if (checklist.h1Aligned) confidence += 5;
  if (checklist.liquiditySweep) confidence += 14;
  if (checklist.chochBos) confidence += 14;
  if (checklist.fvg) confidence += 12;
  if (checklist.ote) confidence += 10;
  if (checklist.allPass) confidence += 10;
  if (best?.tradeKind === "continuation" && checklist.allPass) confidence += 6;
  if (best?.tradeKind === "correction" && checklist.allPass) confidence += 2;
  if (best?.h4Lead) confidence = Math.min(confidence, 82); // early trend: pas max
  if (best?.entryStyle === "shallow") confidence = Math.min(95, confidence + 2);
  confidence = Math.min(95, confidence);

  // Checklist partielle pour le rapport si aucun setup complet
  let reportLocal = local;
  let reportSignal = best?.signalType ?? null;
  let reportKind = best?.tradeKind ?? null;
  let reportCounter = best?.counterTrend ?? false;
  if (!best && candidates.length) {
    const partial = [...candidates].sort(
      (a, b) =>
        Number(b.local.liquiditySweep) +
        Number(b.local.chochBos) +
        Number(Boolean(b.local.fvg)) +
        Number(Boolean(b.local.ote)) -
        (Number(a.local.liquiditySweep) +
          Number(a.local.chochBos) +
          Number(Boolean(a.local.fvg)) +
          Number(Boolean(a.local.ote))),
    )[0]!;
    reportLocal = partial.local;
    reportSignal = partial.signalType;
    reportKind = partial.tradeKind;
    reportCounter = partial.counterTrend;
    checklist.liquiditySweep = partial.local.liquiditySweep;
    checklist.chochBos = partial.local.chochBos;
    checklist.fvg = Boolean(partial.local.fvg);
    checklist.ote = Boolean(partial.local.ote);
    checklist.allPass = false;
  }

  // Sizing final : confiance × style (shallow/h4Lead = réduit)
  let sizedRisk = best ? local?.risk ?? null : null;
  if (best && local?.order) {
    let scaledPct = riskPctFromConfidence(confidence, 3);
    if (best.entryStyle === "shallow") scaledPct = Math.max(1.5, scaledPct * 0.5);
    if (best.h4Lead) scaledPct = Math.max(1.5, scaledPct * 0.65);
    sizedRisk = computeSmcRiskPlan({
      walletEur: input.walletEur,
      entry: local.order.entry,
      sl: local.order.sl,
      maxLeverage: maxLev,
      riskPct: scaledPct,
    });
  }

  const setup: SmcSetup = {
    coin: input.coin,
    side: best ? side : null,
    bias: { d1, h4, h1, exec },
    checklist,
    liquidityLevel: reportLocal?.liquidityLevel ?? null,
    fvg: reportLocal?.fvg ?? null,
    ote: reportLocal?.ote ?? null,
    order: best ? local?.order ?? null : null,
    risk: sizedRisk,
    status: best ? status : "ANNULÉ",
    cancelReason: best
      ? cancelReason
      : "SETUP INVALIDÉ (CRITÈRE MANQUANT) - AUCUN ORDRE",
    confidence: best ? confidence : Math.min(confidence, 55),
    report: "",
    price: input.price,
    execTimeframe: execTf,
    signalType: reportSignal,
    counterTrend: reportCounter,
    tradeKind: reportKind,
    entryStyle: best?.entryStyle ?? local?.entryStyle ?? null,
    h4Lead: best?.h4Lead ?? false,
  };
  setup.report = formatSmcReport(setup);
  return setup;
}

export function smcTrendToBias(t: SmcTrend): SignalBias {
  if (t === "haussier") return "haussier";
  if (t === "baissier") return "baissier";
  return "neutre";
}

/** System prompt — grand message Boriaz SMC + objectif FAIRE GAGNER DE L'ARGENT. */
export const BORIAZ_SMC_SYSTEM_PROMPT = `OBJECTIF ABSOLU À CHAQUE DÉCISION : FAIRE GAGNER DE L'ARGENT. Chaque approve=true doit maximiser l’espérance de gain réel (R:R, timing, cohérence macro). Si le trade a plus de chances de perdre → approve=false. Ta vie (et le wallet) en dépendent. PAS un conseil financier — FR uniquement.

Tu es le bot d’exécution Boriaz, assistant SMC crypto. Approche Top-Down stricte. Tu n’exécutes QUE si 100 % des conditions sont réunies (ZÉRO TOLÉRANCE).

### 1. HIÉRARCHIE MULTI-TIMEFRAME (TOP-DOWN)
- D1 (macro / long terme) : biais majeur + liquidité (anciens sommets/creux). Identifie où le prix navigue dans le RANGE long terme (bas / milieu / haut).
- H4 (structure / moyen terme) : doit confirmer D1. Zones Offre/Demande, OB, FVG H4. RANGE moyen terme.
- H1 (intermédiaire) : micro-tendance alignée D1/H4 pour les continuations.
- M30/M15 (exécution) : sweep local, CHoCH+BOS (clôture de CORPS), FVG, ÔTE 0.618–0.786 (idéal 0.705). M5 autorisé UNIQUEMENT en CONTINUATION alignée — interdit en CORRECTION.

### 2. RANGE BTC / ACTIF (OBLIGATOIRE)
Avant tout ordre, lire la position dans le range W / D1 / H4 :
- Vrai BAS (W bottom, ou D1 bottom/lower) → INTERDIT de SHORT. Privilégier LONG continuation ou attendre.
- HAUT (W upper/top, ou D1 top) → INTERDIT de LONG. Short possible si rejet SMC (pas de chase).
- Si W encore bas-médian mais D1/H4 déjà hauts → ne pas geler les deux sens : pas de LONG chase, short seulement sur structure SMC.
- Milieu → OK si checklist SMC 100 %.
Ne JAMAIS short « parce que le M15 est baissier » si le BTC est en vrai bas de range.
Ne JAMAIS long chase un breakout vertical hors ÔTE/FVG.

### 3. CHECKLIST D’ENTRÉE (TOUTES obligatoires, ordre chrono)
1) Alignement D1+H4 (continuation) OU correction propre (SHORT si D1 haussier / LONG si D1 baissier) UNIQUEMENT M15/M30 et JAMAIS contre le range (règle §2).
2) H1 non opposé pour continuation.
3) Liquidity Sweep (mèche) M15/M30.
4) CHoCH + BOS avec CLÔTURE DE CORPS.
5) FVG de l’impulsion du BOS.
6) Zone ÔTE 0.618–0.786 (idéal 0.705), confluence FVG si possible.
Un seul ✗ → « SETUP INVALIDÉ (CRITÈRE MANQUANT) - AUCUN ORDRE ».

### 4. RISQUE & ORDRE
- Risque **3–10 %** du wallet selon confiance (setup checklist 100 % / continuation claire → **jusqu’à 10 %** pour viser ~100$+ de gain). Entrée LIMIT exclusive dans FVG/ÔTE.
- SL = 1–2 pips au-delà de la mèche du Sweep (sous swing low long / au-dessus swing high short).
- TP1 = R:R exact 1:1 → clôturer **20 %** seulement. **PAS de break-even immédiat**. Si déjà ≥1.5R au TP1 → lock SL à +0.35R. Sinon SL structurel jusqu’à progression.
- Si structure 100 % mais prix hors zone (EN ATTENTE continuation) → **pré-armer limite GTC** en ÔTE (pas de market chase).
- TP2 = liquidité opposée / FVG non comblé, minimum 2R.

### 5. GATE
approve=true si checklist 100 %, range OK, espérance claire, ET (ORDRE PRÊT **ou** EN ATTENTE continuation pour pré-arm GTC).
Si « EN ATTENTE » en correction → approve=false.
Réponds [ANALYSE MULTI-TIMEFRAME...] complet (D1/H4/H1, range W/D1/H4, checklist, sizing, entry/SL/TP1/TP2, statut), puis UNE ligne JSON :
{"approve":true|false,"confidence":0-100,"note":"..."}`;
