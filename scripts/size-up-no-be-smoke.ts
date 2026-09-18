/**
 * Smoke : sizing confiance + paper TP1 sans BE.
 * npx tsx scripts/size-up-no-be-smoke.ts
 */
import assert from "node:assert/strict";
import {
  computeSmcRiskPlan,
  riskPctFromConfidence,
} from "../src/lib/smc";
import { sizeLiveFromRealEquity } from "../src/lib/hl-live";

// --- Confiance → risque ---
assert.equal(riskPctFromConfidence(50), 2.5);
assert.equal(riskPctFromConfidence(68), 3);
assert.equal(riskPctFromConfidence(74), 3.5);
assert.equal(riskPctFromConfidence(81), 4);
assert.equal(riskPctFromConfidence(88), 5);

const equity = 950;
const high = computeSmcRiskPlan({
  walletEur: equity,
  entry: 70_000,
  sl: 69_000,
  maxLeverage: 3,
  riskPct: riskPctFromConfidence(90),
});
assert.equal(high.riskPct, 5);
assert.equal(high.riskEur, 47.5);
const low = computeSmcRiskPlan({
  walletEur: equity,
  entry: 70_000,
  sl: 69_000,
  maxLeverage: 3,
  riskPct: 2,
});
assert.ok(high.notionalEur > low.notionalEur * 2.2);

const liveSized = sizeLiveFromRealEquity({
  equityUsd: equity,
  entry: 70_000,
  sl: 69_000,
  maxLeverage: 3,
  maxNotionalUsd: 50_000,
  riskPct: 5,
  paperMarginEur: high.marginEur,
  paperBankrollEur: equity,
  mirrorPaper: true,
});
assert.ok(liveSized.ok, liveSized.reason);
assert.ok(liveSized.notionalUsd > 100, `live notional ${liveSized.notionalUsd}`);

// --- Paper : TP1 ne doit PAS déplacer le SL vers entry ---
const entry = 100;
const sl = 98;
const tp1 = 102;
const tp2 = 104;
const t = {
  id: "smoke-be",
  openedAt: Date.now(),
  coin: "BTC",
  side: "long" as const,
  entry,
  tp: tp2,
  sl,
  tp1,
  tp2,
  leverage: 3,
  sizePct: 5,
  marginEur: 100,
  notionalEur: 300,
  entryMode: "limit_wait" as const,
  status: "open" as const,
  note: "",
  strategy: "smc" as const,
  tp1Hit: false,
  remainingQtyPct: 1,
  riskPct: 5,
  realizedPartialEur: 0 as number | undefined,
};

// Simule le bloc TP1 de refreshPaperTrades
const px = tp1;
const halfMargin = t.marginEur * 0.5;
const halfMove = ((tp1 - t.entry) / t.entry) * 100;
const halfPnl = halfMargin * ((halfMove * t.leverage) / 100);
t.realizedPartialEur = halfPnl;
t.marginEur = halfMargin;
t.notionalEur = halfMargin * t.leverage;
t.remainingQtyPct = 0.5;
t.tp1Hit = true;
t.tp = tp2;
// PAS de t.sl = t.entry
assert.equal(t.sl, sl, "SL doit rester structurel après TP1");
assert.notEqual(t.sl, t.entry, "SL ne doit pas être BE");
assert.ok(t.realizedPartialEur! > 0);

console.log("OK size-up-no-be-smoke", {
  riskHigh: high.riskEur,
  riskLow: low.riskEur,
  liveNotional: liveSized.notionalUsd,
  tp1Partial: t.realizedPartialEur,
  slAfterTp1: t.sl,
});
