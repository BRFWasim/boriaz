/**
 * Smoke test SMC : LONG aligné vs SHORT counter-trend + LIVE Boriaz only.
 */
import assert from "node:assert/strict";
import {
  analyzeSmcSetup,
  buildSmcOrder,
  computeOte,
} from "../src/lib/smc";
import type { Candle } from "../src/lib/types";
import {
  BORIAZ_PORTFOLIO,
  DEFAULT_PORTFOLIO,
  ensurePortfolios,
  portfolioAllowsLive,
} from "../src/lib/user-types";
import { LIVE_ALLOWED_PORTFOLIO_IDS } from "../src/lib/site-gate";

function mkCandles(
  n: number,
  start: number,
  path: (i: number) => { o: number; h: number; l: number; c: number },
): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const p = path(i);
    out.push({ t: start + i * 60_000, v: 1, ...p });
  }
  return out;
}

/** Tendance haussière structurelle (HH/HL). */
function bullishPath(i: number, base = 100) {
  const c = base + i * 0.4;
  return { o: c - 0.1, h: c + 0.35, l: c - 0.35, c };
}

/** Tendance baissière structurelle (LH/LL). */
function bearishPath(i: number, base = 100) {
  const c = base - i * 0.4;
  return { o: c + 0.1, h: c + 0.35, l: c - 0.35, c };
}

function assertLiveBoriazOnly() {
  assert.equal(portfolioAllowsLive(BORIAZ_PORTFOLIO), true);
  assert.equal(portfolioAllowsLive(DEFAULT_PORTFOLIO), false);
  assert.equal(portfolioAllowsLive({ id: "scalp", name: "Scalp" }), false);
  assert.equal(LIVE_ALLOWED_PORTFOLIO_IDS.has("boriaz"), true);
  assert.equal(LIVE_ALLOWED_PORTFOLIO_IDS.has("default"), false);

  const pfs = ensurePortfolios([
    { ...DEFAULT_PORTFOLIO, liveTradeEnabled: true },
    { ...BORIAZ_PORTFOLIO, tradesPerDay: 0, liveTradeEnabled: true },
    {
      id: "scalp_1",
      name: "Scalp",
      isDefault: false,
      enabled: true,
      paperTradeEnabled: true,
      liveTradeEnabled: true,
      bankrollEur: 1000,
      maxLeverage: 3,
      sizePct: 1,
      minRR: 1,
      targetEur: 100,
      maxLossEur: 50,
      tradesPerDay: 8,
      timeframe: "15m",
      riskLevel: 3,
      requireAiGate: false,
      maxSafetyMode: false,
      strategy: "alignment",
      riskPct: 0.25,
    },
  ]);
  const def = pfs.find((p) => p.id === "default")!;
  const bor = pfs.find((p) => p.id === "boriaz")!;
  const scalp = pfs.find((p) => p.id === "scalp_1")!;
  assert.equal(def.liveTradeEnabled, false);
  assert.equal(scalp.liveTradeEnabled, false);
  assert.equal(bor.tradesPerDay, 0);
  assert.equal(bor.strategy, "smc");
  assert.equal(bor.riskPct, 2);
  console.log("OK live Boriaz only + trades illimités");
}

function assertRiskSizing() {
  const ote = computeOte("long", 110, 100)!;
  const order = buildSmcOrder({
    side: "long",
    price: 104,
    ote,
    fvg: { high: 105, low: 103, mid: 104, direction: "long", index: 10 },
    impulseHigh: 110,
    impulseLow: 100,
    sweepLevel: 99.5,
  });
  assert.ok(order.sl < order.entry);
  assert.ok(Math.abs(order.tp1 - order.entry - (order.entry - order.sl)) < 1e-6);
  assert.ok(
    Math.abs(order.tp2 - order.entry - 2 * (order.entry - order.sl)) < 1e-6,
  );
  console.log("OK SL sweep + TP1 1R + TP2 2R");
}

function assertShortCtAllowedWhenMacroBull() {
  // D1/H4 haussiers — LONG possible si checklist, SHORT CT aussi si checklist
  const d1 = mkCandles(80, 1, (i) => bullishPath(i, 90));
  const h4 = mkCandles(60, 1, (i) => bullishPath(i, 95));
  const h1 = mkCandles(60, 1, (i) => bullishPath(i, 98));

  // Exec : fabrique un short CT synthétique grossier — on vérifie surtout
  // que analyzeSmcSetup n’annule PAS les shorts uniquement pour D1/H4 bull.
  // (checklist complète dépend des détecteurs ; on teste le signalType path)
  const exec = mkCandles(60, 1, (i) => {
    // rally puis sweep haut + dump pour short
    if (i < 40) return bullishPath(i, 100);
    const c = 116 - (i - 40) * 0.8;
    if (i === 42) {
      return { o: 114, h: 118.5, l: 113.5, c: 114.2 }; // sweep high wick
    }
    return { o: c + 0.2, h: c + 0.5, l: c - 0.6, c };
  });

  const setup = analyzeSmcSetup({
    coin: "BTC",
    price: exec.at(-1)!.c,
    candlesD1: d1,
    candlesH4: h4,
    candlesH1: h1,
    candlesExec: exec,
    walletEur: 1000,
    maxLeverage: 3,
    execTimeframe: "15m",
  });

  assert.equal(setup.bias.d1, "haussier");
  assert.equal(setup.bias.h4, "haussier");
  // Si un short est sélectionné sous macro bull → doit être counter-trend
  if (setup.side === "short") {
    assert.equal(setup.signalType, "short_counter_trend");
    assert.equal(setup.counterTrend, true);
    assert.ok(setup.checklist.allPass);
    console.log("OK SHORT counter-trend sous D1/H4 haussiers");
  } else if (setup.side === "long") {
    assert.equal(setup.signalType, "long_aligned");
    console.log("OK LONG aligné (short CT non complet sur synthétique)");
  } else {
    // Pas de setup actionable — on vérifie juste que cancelReason n’est PAS
    // « short bloqué par D1/H4 »
    assert.ok(
      !/short.*bloqu|bloque.*short|D1.*H4.*short/i.test(
        setup.cancelReason || "",
      ),
    );
    console.log(
      "OK pas de blocage SHORT par D1/H4 (checklist locale incomplète synthétique)",
    );
  }
}

assertLiveBoriazOnly();
assertRiskSizing();
assertShortCtAllowedWhenMacroBull();
console.log("All smoke checks passed");
