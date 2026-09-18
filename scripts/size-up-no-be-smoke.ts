/**
 * Smoke : sizing prudent (cap 4%) + TP1 20% sans BE.
 * npx tsx scripts/size-up-no-be-smoke.ts
 */
import assert from "node:assert/strict";
import {
  computeSmcRiskPlan,
  riskPctFromConfidence,
  SMC_TP1_CLOSE_FRAC,
} from "../src/lib/smc";
import { sizeLiveFromRealEquity, getLiveConfig } from "../src/lib/hl-live";

assert.equal(SMC_TP1_CLOSE_FRAC, 0.2);
assert.ok(riskPctFromConfidence(50) <= 2.5);
assert.ok(riskPctFromConfidence(74) <= 2.5);
assert.equal(riskPctFromConfidence(81), 3);
assert.equal(riskPctFromConfidence(90), 4);
assert.ok(riskPctFromConfidence(99) <= 4);

const equity = 950;
const high = computeSmcRiskPlan({
  walletEur: equity,
  entry: 70_000,
  sl: 69_300, // ~1% SL
  maxLeverage: 5,
  riskPct: riskPctFromConfidence(90),
});
assert.equal(high.riskPct, 4);
// 4% × 1.8R ≈ 68$ — positif sans all-in
const expectedWinAtTp2 =
  high.riskEur * (SMC_TP1_CLOSE_FRAC * 1 + (1 - SMC_TP1_CLOSE_FRAC) * 2);
assert.ok(
  expectedWinAtTp2 >= 50,
  `gain TP2 attendu ${expectedWinAtTp2.toFixed(1)}$ < 50$`,
);
assert.ok(high.riskEur <= equity * 0.045);

const cfg = getLiveConfig();
assert.ok(cfg.maxLeverage <= 6);
assert.ok(cfg.maxOpenPositions <= 3);

const liveSized = sizeLiveFromRealEquity({
  equityUsd: equity,
  entry: 70_000,
  sl: 69_300,
  maxLeverage: 5,
  maxNotionalUsd: 6_000,
  riskPct: 4,
  paperMarginEur: high.marginEur,
  paperBankrollEur: equity,
  mirrorPaper: true,
});
assert.ok(liveSized.ok, liveSized.reason);

// Paper TP1 20% : SL structurel
const entry = 100;
const sl = 98;
const tp1 = 102;
const t = {
  entry,
  sl,
  marginEur: 100,
  notionalEur: 500,
  leverage: 5,
  feesEur: 2,
  realizedPartialEur: 0 as number | undefined,
  remainingQtyPct: 1,
  tp1Hit: false,
  tp: 104,
};
const closeFrac = SMC_TP1_CLOSE_FRAC;
const keepFrac = 1 - closeFrac;
const closeMargin = t.marginEur * closeFrac;
const halfMove = ((tp1 - t.entry) / t.entry) * 100;
const closePnl = closeMargin * ((halfMove * t.leverage) / 100);
t.realizedPartialEur = closePnl;
t.marginEur = t.marginEur * keepFrac;
t.remainingQtyPct = keepFrac;
t.tp1Hit = true;
assert.equal(t.sl, sl);
assert.equal(t.remainingQtyPct, 0.8);

console.log("OK size-up-no-be-smoke (prudent)", {
  riskHigh: high.riskEur,
  expectedWinAtTp2: Math.round(expectedWinAtTp2 * 100) / 100,
  liveNotional: liveSized.notionalUsd,
  maxLev: cfg.maxLeverage,
  maxPos: cfg.maxOpenPositions,
});
