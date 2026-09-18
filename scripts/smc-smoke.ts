import assert from "node:assert/strict";
import {
  analyzeSmcSetup,
  computeOte,
  computeSmcRiskPlan,
  detectFvg,
  formatSmcReport,
  riskPctFromConfidence,
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

assert.equal(riskPctFromConfidence(60), 3);
assert.equal(riskPctFromConfidence(70), 4);
assert.equal(riskPctFromConfidence(75), 6);
assert.equal(riskPctFromConfidence(82), 8);
assert.equal(riskPctFromConfidence(90), 10);

const risk = computeSmcRiskPlan({
  walletEur: 950,
  entry: 100,
  sl: 98.5,
  maxLeverage: 8,
  riskPct: riskPctFromConfidence(90),
});
assert.equal(risk.riskPct, 10);
assert.ok(risk.riskEur >= 60, `riskEur ${risk.riskEur}`);
assert.ok(risk.notionalEur > 4000, `notional trop petit: ${risk.notionalEur}`);

const riskLow = computeSmcRiskPlan({
  walletEur: 1000,
  entry: 100,
  sl: 98.5,
  maxLeverage: 3,
  riskPct: 2,
});
assert.equal(riskLow.riskEur, 20);
assert.ok(riskLow.notionalEur > 1200 && riskLow.notionalEur < 1400);

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
assert.ok(report.includes("[ANALYSE TIMEFRAME]"));
assert.ok(report.includes("Statut :"));
assert.ok(setup.bias.d1 === "haussier" || setup.bias.d1 === "neutre" || setup.bias.d1 === "baissier");
if (setup.checklist.allPass && setup.risk) {
  assert.ok(
    setup.risk.riskPct >= 6,
    `setup sûr doit risquer ≥6%, got ${setup.risk.riskPct}`,
  );
}

console.log("SMC smoke OK", {
  bias: setup.bias,
  checklist: setup.checklist,
  status: setup.status,
  confidence: setup.confidence,
  riskPct: setup.risk?.riskPct,
});
