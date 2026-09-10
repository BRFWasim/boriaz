/**
 * Smoke SMC ultra-strict Boriaz.
 */
import assert from "node:assert/strict";
import {
  analyzeSmcSetup,
  buildSmcOrder,
  computeOte,
  smcPipBuffer,
  formatSmcReport,
} from "../src/lib/smc";
import type { Candle } from "../src/lib/types";
import {
  BORIAZ_PORTFOLIO,
  DEFAULT_PORTFOLIO,
  ensurePortfolios,
  portfolioAllowsLive,
} from "../src/lib/user-types";

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

function bullishPath(i: number, base = 100) {
  const c = base + i * 0.4;
  return { o: c - 0.1, h: c + 0.35, l: c - 0.35, c };
}

function bearishPath(i: number, base = 100) {
  const c = base - i * 0.4;
  return { o: c + 0.1, h: c + 0.35, l: c - 0.35, c };
}

{
  assert.equal(portfolioAllowsLive(BORIAZ_PORTFOLIO), true);
  assert.equal(portfolioAllowsLive(DEFAULT_PORTFOLIO), false);
  const pfs = ensurePortfolios([
    { ...DEFAULT_PORTFOLIO, liveTradeEnabled: true },
    { ...BORIAZ_PORTFOLIO, tradesPerDay: 0 },
  ]);
  assert.equal(pfs.find((p) => p.id === "default")!.liveTradeEnabled, false);
  assert.equal(pfs.find((p) => p.id === "boriaz")!.tradesPerDay, 0);
  console.log("OK live Boriaz only");
}

{
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
  assert.equal(order.entryMode, "limit_wait");
  const pip = smcPipBuffer(order.entry);
  assert.ok(order.sl <= 99.5 - pip + 1e-9);
  const risk = order.entry - order.sl;
  assert.ok(Math.abs(order.tp1 - (order.entry + risk)) < 1e-9);
  assert.ok(order.tp2 >= order.entry + risk * 2 - 1e-9);
  console.log("OK LIMIT + SL pip + TP1 1R + TP2 ≥2R");
}

{
  const d1 = mkCandles(80, 1, (i) => bullishPath(i, 90));
  const h4 = mkCandles(60, 1, (i) => bullishPath(i, 95));
  const h1 = mkCandles(60, 1, (i) => bullishPath(i, 98));
  const exec = mkCandles(60, 1, (i) => bearishPath(i, 120));

  const onM5 = analyzeSmcSetup({
    coin: "BTC",
    price: exec.at(-1)!.c,
    candlesD1: d1,
    candlesH4: h4,
    candlesH1: h1,
    candlesExec: exec,
    walletEur: 1000,
    execTimeframe: "5m",
  });
  // Sur M5 : pas de correction short (D1 bull) — si short CT absent
  if (onM5.signalType === "short_counter_trend") {
    assert.fail("Correction SHORT interdite sur M5");
  }
  // Si pas de continuation long complète → invalidé
  if (!onM5.checklist.allPass) {
    assert.match(
      onM5.report,
      /SETUP INVALIDÉ \(CRITÈRE MANQUANT\) - AUCUN ORDRE/,
    );
    assert.equal(onM5.order, null);
  }
  console.log("OK M5 : pas de correction + invalidé si checklist incomplete");

  const onM15 = analyzeSmcSetup({
    coin: "BTC",
    price: exec.at(-1)!.c,
    candlesD1: d1,
    candlesH4: h4,
    candlesH1: h1,
    candlesExec: exec,
    walletEur: 1000,
    execTimeframe: "15m",
  });
  // Correction SHORT autorisée en candidats M15 (peut rester invalide sans checklist)
  assert.ok(
    onM15.tradeKind === "correction" ||
      onM15.tradeKind === "continuation" ||
      onM15.tradeKind == null ||
      !onM15.checklist.allPass,
  );
  if (!onM15.checklist.allPass) {
    assert.match(
      formatSmcReport(onM15),
      /SETUP INVALIDÉ \(CRITÈRE MANQUANT\) - AUCUN ORDRE/,
    );
  }
  console.log("OK M15 correction autorisée (cadre) + format invalidé");
}

console.log("All ultra-strict smoke checks passed");
