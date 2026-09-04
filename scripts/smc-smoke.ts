import assert from "node:assert/strict";
import {
  analyzeSmcSetup,
  computeOte,
  computeSmcRiskPlan,
  detectFvg,
  formatSmcReport,
} from "../src/lib/smc";
import type { Candle } from "../src/lib/types";

function candle(
  i: number,
  o: number,
  h: number,
  l: number,
  c: number,
): Candle {
  return { t: i * 60_000, o, h, l, c, v: 1000 };
}

const ote = computeOte("long", 110, 100);
assert.ok(ote);
assert.ok(Math.abs(ote!.ideal - (110 - 10 * 0.705)) < 1e-9);

const risk = computeSmcRiskPlan({
  walletEur: 1000,
  entry: 100,
  sl: 98.5,
  maxLeverage: 3,
  riskPct: 2,
});
assert.equal(risk.riskEur, 20);
assert.ok(risk.notionalEur > 1200 && risk.notionalEur < 1400);

const fvg = detectFvg(
  [
    candle(0, 10, 10.5, 9.8, 10.2),
    candle(1, 10.2, 10.3, 10.1, 10.25),
    candle(2, 11.0, 11.5, 10.9, 11.2),
  ],
  "long",
);
assert.ok(fvg);
assert.equal(fvg!.direction, "long");

function trendingUp(n: number, start = 100): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const base = start + i * 0.4;
    const bump = i % 5 === 0 ? -1.2 : i % 5 === 2 ? 1.5 : 0.2;
    const c = base + bump;
    out.push(
      candle(i, base, Math.max(base, c) + 0.3, Math.min(base, c) - 0.3, c),
    );
  }
  return out;
}

const setup = analyzeSmcSetup({
  coin: "BTC",
  price: 124.2,
  candlesD1: trendingUp(80, 80),
  candlesH4: trendingUp(80, 90),
  candlesH1: trendingUp(80, 95),
  candlesExec: trendingUp(80, 100),
  walletEur: 1000,
  maxLeverage: 3,
});
const report = formatSmcReport(setup);
assert.ok(report.includes("[ANALYSE MULTI-TIMEFRAME (TOP-DOWN)]"));
assert.ok(report.includes("Statut :"));
assert.ok(setup.bias.d1 === "haussier" || setup.bias.d1 === "neutre" || setup.bias.d1 === "baissier");

console.log("SMC smoke OK", {
  bias: setup.bias,
  checklist: setup.checklist,
  status: setup.status,
  confidence: setup.confidence,
});
