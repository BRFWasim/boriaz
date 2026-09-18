/**
 * Smoke logique capture-moves (pré-arm / liveEligible).
 * npx tsx scripts/capture-moves-smoke.ts
 */
import assert from "node:assert/strict";

// Simule les règles liveEligible / waiting arm
function liveEligible(input: {
  aiApproved: boolean;
  allPass: boolean;
  status: string;
  tradeKind: string | null;
  counterTrend: boolean;
  entryMode: string;
  model: string;
  aiConfidence: number;
  minConf: number;
}) {
  return (
    input.aiApproved &&
    input.allPass &&
    (input.status === "ORDRE PRÊT À ÊTRE EXÉCUTÉ" ||
      (input.status === "EN ATTENTE DE RETRACEMENT" &&
        input.tradeKind === "continuation" &&
        !input.counterTrend)) &&
    input.entryMode === "limit_wait" &&
    input.model !== "mechanical-smc" &&
    input.aiConfidence >= input.minConf
  );
}

assert.equal(
  liveEligible({
    aiApproved: true,
    allPass: true,
    status: "EN ATTENTE DE RETRACEMENT",
    tradeKind: "continuation",
    counterTrend: false,
    entryMode: "limit_wait",
    model: "chatgpt",
    aiConfidence: 80,
    minConf: 74,
  }),
  true,
  "EN ATTENTE continuation doit être liveEligible",
);

assert.equal(
  liveEligible({
    aiApproved: true,
    allPass: true,
    status: "EN ATTENTE DE RETRACEMENT",
    tradeKind: "correction",
    counterTrend: true,
    entryMode: "limit_wait",
    model: "chatgpt",
    aiConfidence: 90,
    minConf: 82,
  }),
  false,
  "EN ATTENTE correction ne doit PAS être liveEligible",
);

assert.equal(
  liveEligible({
    aiApproved: true,
    allPass: true,
    status: "ORDRE PRÊT À ÊTRE EXÉCUTÉ",
    tradeKind: "continuation",
    counterTrend: false,
    entryMode: "limit_wait",
    model: "chatgpt",
    aiConfidence: 80,
    minConf: 74,
  }),
  true,
);

// Trail lock : ≥1.5R → SL +0.35R
function trailSl(side: "long" | "short", entry: number, sl: number, px: number) {
  const risk = Math.abs(entry - sl);
  const r =
    side === "long" ? (px - entry) / risk : (entry - px) / risk;
  if (r >= 1.5) {
    return side === "long" ? entry + risk * 0.35 : entry - risk * 0.35;
  }
  return sl;
}
assert.equal(trailSl("long", 100, 98, 102), 98); // at 1R keep structural
assert.equal(trailSl("long", 100, 98, 103.1), 100.7); // 1.55R → lock 0.35R
assert.equal(trailSl("short", 100, 102, 96.9), 99.3);

console.log("OK capture-moves-smoke");
