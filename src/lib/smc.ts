/**
 * Smart Money Concepts (SMC) — analyse top-down + checklist d’entrée.
 * Utilisé par le portefeuille « Boriaz ».
 */
import type { Candle, SignalBias } from "./types";

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
  /** LONG aligné macro vs SHORT counter-trend petite TF. */
  signalType?:
    | "long_aligned"
    | "short_aligned"
    | "short_counter_trend"
    | null;
  counterTrend?: boolean;
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
 * CHoCH + BOS confirmés par clôture de corps.
 * LONG : break au-dessus d’un swing high après un sweep bas.
 * SHORT : break sous un swing low après un sweep haut.
 */
export function detectChochBos(
  candles: Candle[],
  side: SmcSide,
): { ok: boolean; bosLevel: number | null; impulseHigh: number; impulseLow: number } {
  const swings = findSwings(candles, 2);
  if (candles.length < 15 || swings.length < 3) {
    return { ok: false, bosLevel: null, impulseHigh: 0, impulseLow: 0 };
  }
  const last = candles.at(-1)!;
  const window = candles.slice(-24);

  if (side === "long") {
    const highs = swings.filter((s) => s.kind === "high").slice(-6);
    const lows = swings.filter((s) => s.kind === "low").slice(-6);
    const bosTarget = highs.at(-2) ?? highs.at(-1);
    const swingLow = lows.at(-1);
    if (!bosTarget || !swingLow) {
      return { ok: false, bosLevel: null, impulseHigh: 0, impulseLow: 0 };
    }
    const broke = window.some((c) => c.c > bosTarget.price);
    const impulseHigh = Math.max(...window.map((c) => c.h));
    const impulseLow = Math.min(swingLow.price, Math.min(...window.slice(-8).map((c) => c.l)));
    // Clôture récente encore au-dessus OU break clair dans la fenêtre
    const ok =
      broke &&
      (last.c > bosTarget.price * 0.997 ||
        window.slice(-4).some((c) => c.c > bosTarget.price * 1.001));
    return {
      ok,
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
  const broke = window.some((c) => c.c < bosTarget.price);
  const impulseLow = Math.min(...window.map((c) => c.l));
  const impulseHigh = Math.max(swingHigh.price, Math.max(...window.slice(-8).map((c) => c.h)));
  const ok =
    broke &&
    (last.c < bosTarget.price * 1.003 ||
      window.slice(-4).some((c) => c.c < bosTarget.price * 0.999));
  return {
    ok,
    bosLevel: bosTarget.price,
    impulseHigh,
    impulseLow,
  };
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

export function computeSmcRiskPlan(input: {
  walletEur: number;
  entry: number;
  sl: number;
  maxLeverage: number;
  riskPct?: number;
}): SmcRiskPlan {
  const riskPct = input.riskPct ?? 2;
  const walletEur = Math.max(100, input.walletEur);
  const riskEur = walletEur * (riskPct / 100);
  const slDistancePct =
    input.entry > 0
      ? (Math.abs(input.entry - input.sl) / input.entry) * 100
      : 1;
  const dist = Math.max(0.15, slDistancePct) / 100;
  const notionalEur = riskEur / dist;
  // Levier : assez pour porter le notionnel avec une marge raisonnable
  let leverage = Math.min(
    input.maxLeverage,
    Math.max(1, Math.ceil(notionalEur / (walletEur * 0.25))),
  );
  leverage = Math.min(input.maxLeverage, Math.max(1, leverage));
  const marginEur = notionalEur / leverage;
  const sizePct = Math.min(25, Math.max(0.5, (marginEur / walletEur) * 100));
  return {
    walletEur,
    riskPct,
    riskEur,
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
  /** Niveau exact du sweep (mèche) — SL sous/au-dessus. */
  sweepLevel?: number | null;
}): SmcOrderParams {
  const { side, price, ote, fvg, impulseHigh, impulseLow } = input;
  let entry = ote.ideal;
  // Confluence FVG ∩ ÔTE
  if (fvg) {
    const overlapLow = Math.max(ote.low, fvg.low);
    const overlapHigh = Math.min(ote.high, fvg.high);
    if (overlapHigh > overlapLow) {
      entry = (overlapLow + overlapHigh) / 2;
    }
  }

  const buffer = Math.abs(impulseHigh - impulseLow) * 0.05;
  const sweep = input.sweepLevel != null && input.sweepLevel > 0
    ? input.sweepLevel
    : null;
  let sl: number;
  let tp1: number;
  let tp2: number;

  if (side === "long") {
    // SL sous la mèche du sweep bas
    sl = (sweep != null ? Math.min(sweep, impulseLow) : impulseLow) - buffer;
    const risk = entry - sl;
    tp1 = entry + risk; // 1R
    tp2 = entry + risk * 2; // 2R
  } else {
    // SL au-dessus de la mèche du sweep haut
    sl = (sweep != null ? Math.max(sweep, impulseHigh) : impulseHigh) + buffer;
    const risk = sl - entry;
    tp1 = entry - risk;
    tp2 = entry - risk * 2;
  }

  const distPct = Math.abs(price - entry) / price;
  const entryMode: SmcOrderParams["entryMode"] =
    distPct < 0.005 ? "market_now" : "limit_wait";
  if (entryMode === "market_now") {
    // Recalcule TP/SL depuis le prix marché en gardant le même R
    const risk =
      side === "long" ? Math.abs(price - sl) : Math.abs(sl - price);
    entry = price;
    if (side === "long") {
      tp1 = entry + risk;
      tp2 = entry + risk * 2;
    } else {
      tp1 = entry - risk;
      tp2 = entry - risk * 2;
    }
  }

  return { side, entry, sl, tp1, tp2, entryMode };
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
      ? "LONG Alignée"
      : setup.signalType === "short_counter_trend"
        ? "SHORT Counter-Trend Validé"
        : setup.signalType === "short_aligned"
          ? "SHORT Alignée"
          : setup.side
            ? setup.side.toUpperCase()
            : "—";
  const d1Label =
    b.d1 === "haussier" ? "Haussière" : b.d1 === "baissier" ? "Baissière" : "Neutre";
  const h4Label =
    b.h4 === "haussier" ? "Haussière" : b.h4 === "baissier" ? "Baissière" : "Neutre";

  const lines = [
    "[ANALYSE TIMEFRAME]",
    "",
    `Tendance Daily (D1) / H4 : ${d1Label} / ${h4Label}`,
    `Timeframe d'Exécution : ${execLabel}`,
    `Type de Signal : ${signalLabel}`,
    "",
    "",
    `[CHECKLIST SMC (${execLabel})]`,
    "",
    `Liquidity Sweep : ${c.liquiditySweep ? `VALIDE (${setup.liquidityLevel != null ? fmt(setup.liquidityLevel) : "niveau local"})` : "NON VALIDE"}`,
    `CHoCH / BOS : ${c.chochBos ? "VALIDE" : "NON VALIDE"}`,
    `FVG identifié : ${c.fvg && setup.fvg ? `VALIDE (${fmt(setup.fvg.low)} – ${fmt(setup.fvg.high)})` : "NON VALIDE"}`,
    `Zone ÔTE (0.618 - 0.786) : ${c.ote && setup.ote ? `VALIDE (${fmt(setup.ote.low)} – ${fmt(setup.ote.high)})` : "NON VALIDE"}`,
    "",
    "",
    "[RÈGLES DE RISQUE & SIZING]",
    "",
  ];

  if (setup.risk) {
    lines.push(
      `Capital Risqué (${setup.risk.riskPct}%) : ${setup.risk.riskEur.toFixed(2)} $`,
      `Distance SL (%) : ${setup.risk.slDistancePct.toFixed(2)}%`,
      `Taille de la position : ${setup.risk.notionalEur.toLocaleString("fr-FR")} $`,
    );
  } else {
    lines.push(
      "Capital Risqué (2%) : —",
      "Distance SL (%) : —",
      "Taille de la position : —",
    );
  }

  lines.push("", "", "[PARAMÈTRES DE L'ORDRE]", "");
  if (setup.order) {
    lines.push(
      `Type d'ordre : ${setup.order.entryMode === "limit_wait" ? "LIMIT" : "MARKET"} ${setup.order.side.toUpperCase()}`,
      `Prix d'entrée (Entry) : ${fmt(setup.order.entry)}`,
      `Stop Loss Initial (SL) : ${fmt(setup.order.sl)}`,
      `TP1 (R:R 1:1 - Clôture 50% + BE) : ${fmt(setup.order.tp1)}`,
      `TP2 Final (R:R 2:1) : ${fmt(setup.order.tp2)}`,
    );
  } else {
    lines.push(
      "Type d'ordre : —",
      "Prix d'entrée (Entry) : —",
      "Stop Loss Initial (SL) : —",
      "TP1 (R:R 1:1 - Clôture 50% + BE) : —",
      "TP2 Final (R:R 2:1) : —",
    );
  }

  const statusLine =
    setup.status === "ANNULÉ" && setup.cancelReason
      ? `ANNULÉ - ${setup.cancelReason}`
      : setup.status;
  lines.push("", "", `Statut : ${statusLine}`);
  return lines.join("\n");
}

function evaluateSideOnExec(input: {
  side: SmcSide;
  candlesExec: Candle[];
  price: number;
  walletEur: number;
  maxLeverage: number;
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
} {
  const liq = detectLiquiditySweep(input.candlesExec, input.side);
  const bos = detectChochBos(input.candlesExec, input.side);
  let impulseHigh = bos.impulseHigh;
  let impulseLow = bos.impulseLow;
  const fvg = detectFvg(input.candlesExec, input.side);

  if ((!bos.ok || impulseHigh <= impulseLow) && liq.ok) {
    const win = input.candlesExec.slice(-20);
    impulseHigh = Math.max(...win.map((c) => c.h));
    impulseLow = Math.min(...win.map((c) => c.l));
  }

  let ote: OteZone | null = null;
  if (impulseHigh > impulseLow) {
    ote = computeOte(input.side, impulseHigh, impulseLow);
  }

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
    });
    risk = computeSmcRiskPlan({
      walletEur: input.walletEur,
      entry: order.entry,
      sl: order.sl,
      maxLeverage: input.maxLeverage,
      riskPct: 2,
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
  const maxLev = input.maxLeverage ?? 3;
  const execTf = input.execTimeframe ?? "15m";

  const longMacroOk = d1 === "haussier" && h4 === "haussier";
  const shortMacroAligned = d1 === "baissier";

  type Candidate = {
    side: SmcSide;
    signalType: NonNullable<SmcSetup["signalType"]>;
    counterTrend: boolean;
    local: ReturnType<typeof evaluateSideOnExec>;
  };

  const candidates: Candidate[] = [];

  if (longMacroOk) {
    const local = evaluateSideOnExec({
      side: "long",
      candlesExec: input.candlesExec,
      price: input.price,
      walletEur: input.walletEur,
      maxLeverage: maxLev,
    });
    candidates.push({
      side: "long",
      signalType: "long_aligned",
      counterTrend: false,
      local,
    });
  }

  {
    const local = evaluateSideOnExec({
      side: "short",
      candlesExec: input.candlesExec,
      price: input.price,
      walletEur: input.walletEur,
      maxLeverage: maxLev,
    });
    candidates.push({
      side: "short",
      signalType: shortMacroAligned ? "short_aligned" : "short_counter_trend",
      counterTrend: !shortMacroAligned,
      local,
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
        (c.signalType === "long_aligned" ? 3 : 0) +
        (c.signalType === "short_aligned" ? 2 : 0) +
        (c.signalType === "short_counter_trend" ? 1 : 0);
      return score(b) - score(a);
    });

  const best = complete[0] ?? null;
  const side = best?.side ?? null;
  const local = best?.local;
  const mtfAligned = side === "long" ? longMacroOk : Boolean(best);
  const h1Aligned =
    side === "long"
      ? h1 !== "baissier"
      : side === "short"
        ? best?.counterTrend
          ? true
          : h1 !== "haussier"
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
    local?.risk != null &&
    (side === "long" ? longMacroOk : true);

  let status: SmcStatus = "ANNULÉ";
  let cancelReason: string | null = null;
  if (!best) {
    cancelReason =
      "Checklist SMC locale incomplète (Sweep + CHoCH/BOS + FVG + ÔTE) ou LONG sans D1+H4 haussiers";
  } else if (side === "long" && !longMacroOk) {
    cancelReason = "LONG : D1+H4 haussiers requis";
  } else if (checklist.allPass && local?.order && local.ote) {
    const inOte =
      local.order.entryMode === "market_now" ||
      (input.price >= local.ote.low * 0.995 &&
        input.price <= local.ote.high * 1.005);
    status = inOte
      ? "ORDRE PRÊT À ÊTRE EXÉCUTÉ"
      : "EN ATTENTE DE RETRACEMENT";
    cancelReason = null;
  } else {
    cancelReason = "Conditions SMC incomplètes";
  }

  let confidence = 40;
  if (checklist.mtfAligned) confidence += 8;
  if (checklist.h1Aligned) confidence += 6;
  if (checklist.liquiditySweep) confidence += 12;
  if (checklist.chochBos) confidence += 12;
  if (checklist.fvg) confidence += 10;
  if (checklist.ote) confidence += 8;
  if (checklist.allPass) confidence += 10;
  if (best?.signalType === "short_counter_trend" && checklist.allPass) {
    confidence += 2;
  }
  if (best?.signalType === "short_aligned" && checklist.allPass) {
    confidence += 4;
  }
  confidence = Math.min(95, confidence);

  const setup: SmcSetup = {
    coin: input.coin,
    side,
    bias: { d1, h4, h1, exec },
    checklist,
    liquidityLevel: local?.liquidityLevel ?? null,
    fvg: local?.fvg ?? null,
    ote: local?.ote ?? null,
    order: local?.order ?? null,
    risk: local?.risk ?? null,
    status,
    cancelReason,
    confidence,
    report: "",
    price: input.price,
    execTimeframe: execTf,
    signalType: best?.signalType ?? null,
    counterTrend: best?.counterTrend ?? false,
  };
  setup.report = formatSmcReport(setup);
  return setup;
}

export function smcTrendToBias(t: SmcTrend): SignalBias {
  if (t === "haussier") return "haussier";
  if (t === "baissier") return "baissier";
  return "neutre";
}

/** System prompt — bot SMC Boriaz (shorts CT petite TF autorisés). */
export const BORIAZ_SMC_SYSTEM_PROMPT = `Tu es un bot d'exécution et un assistant de trading IA spécialisé dans les Smart Money Concepts (SMC) pour le marché des crypto-monnaies. Ton rôle est de scanner le marché, d'analyser la structure du prix et d'exécuter des trades dès que les conditions de la stratégie sont réunies en petites timeframes.

Règles :
1. LONG : alignement macro D1 + H4 haussiers OBLIGATOIRE, puis checklist locale M5/M15/M30 complète.
2. SHORT : NE BLOQUE PAS sous prétexte que D1/H4 est haussier. SHORT counter-trend M5/M15/M30 autorisé si checklist SMC locale 100% confirmée (Sweep + CHoCH/BOS + FVG + ÔTE).
3. Checklist locale obligatoire : Liquidity Sweep (mèche), CHoCH+BOS (clôture corps), FVG, zone ÔTE 0.618-0.786.
4. Risque exact 2% du solde wallet. SL sous mèche sweep (long) / au-dessus (short).
5. TP1 = 1R (clôturer 50% + BE), TP2 = 2R (50% restants). Entrée LIMIT dans ÔTE/FVG.
6. PAS un conseil financier. FR uniquement.
7. Réponds UNIQUEMENT avec le format d'analyse SMC demandé, puis un JSON compact : {"approve":true|false,"confidence":0-100}`;
