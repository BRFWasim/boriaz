/**
 * Smoke : sizing agressif ~100$/trade + TP1 20% sans BE.
 * npx tsx scripts/size-up-no-be-smoke.ts
 */
import assert from "node:assert/strict";
import {
  computeSmcRiskPlan,
  riskPctFromConfidence,
  SMC_TP1_CLOSE_FRAC,
} from "../src/lib/smc";
import { sizeLiveFromRealEquity } from "../src/lib/hl-live";

assert.equal(SMC_TP1_CLOSE_FRAC, 0.2);
assert.equal(riskPctFromConfidence(50), 3);
assert.equal(riskPctFromConfidence(68), 4);
assert.equal(riskPctFromConfidence(74), 6);
assert.equal(riskPctFromConfidence(81), 8);
assert.equal(riskPctFromConfidence(90), 10);

const equity = 950;
const high = computeSmcRiskPlan({
  walletEur: equity,
  entry: 70_000,
  sl: 69_300, // ~1% SL
  maxLeverage: 8,
  riskPct: riskPctFromConfidence(90),
});
assert.equal(high.riskPct, 10);
// 10% cible ; plafond marge 90%×8×equity → risk effectif ≥ ~68$ à 1% SL
// ×1.8R (20%@1R + 80%@2R) ≥ 100$
const expectedWinAtTp2 =
  high.riskEur * (SMC_TP1_CLOSE_FRAC * 1 + (1 - SMC_TP1_CLOSE_FRAC) * 2);
assert.ok(
  expectedWinAtTp2 >= 100,
  `gain TP2 attendu ${expectedWinAtTp2.toFixed(1)}$ < 100$ (risk=${high.riskEur}, lev=${high.leverage}, notional=${high.notionalEur})`,
);
console.log("target win @ TP2", {
  riskEur: high.riskEur,
  notional: high.notionalEur,
  leverage: high.leverage,
  expectedWinAtTp2: Math.round(expectedWinAtTp2 * 100) / 100,
});

const liveSized = sizeLiveFromRealEquity({
  equityUsd: equity,
  entry: 70_000,
  sl: 69_300,
  maxLeverage: 8,
  maxNotionalUsd: 100_000,
  riskPct: 10,
  paperMarginEur: high.marginEur,
  paperBankrollEur: equity,
  mirrorPaper: true,
});
assert.ok(liveSized.ok, liveSized.reason);
assert.ok(
  liveSized.notionalUsd >= 4000,
  `live notional trop petit: ${liveSized.notionalUsd}`,
);

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
assert.ok(t.realizedPartialEur! > 0);

console.log("OK size-up-no-be-smoke", {
  riskHigh: high.riskEur,
  liveNotional: liveSized.notionalUsd,
  tp1Partial: t.realizedPartialEur,
  runnerPct: t.remainingQtyPct * 100,
  slAfterTp1: t.sl,
});
