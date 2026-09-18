/**
 * Smoke : SL breathing room + min distance alts.
 * npx tsx scripts/protect-sl-reentry-smoke.ts
 */
import assert from "node:assert/strict";
import {
  enforceMinSlBreathingRoom,
  minSlDistancePct,
} from "../src/lib/smc";

assert.equal(minSlDistancePct(0.08), 0.012);
assert.ok(minSlDistancePct(100) <= 0.005);

const tight = enforceMinSlBreathingRoom({
  side: "short",
  entry: 0.087949,
  sl: 0.088262, // ~0.35% — trop serré
  tp1: 0.087636,
  tp2: 0.087323,
});
assert.equal(tight.widened, true);
assert.ok((tight.sl - 0.087949) / 0.087949 >= 0.0119);
assert.ok(tight.tp1 < 0.087949);

const ok = enforceMinSlBreathingRoom({
  side: "short",
  entry: 0.087949,
  sl: 0.087949 * 1.015,
  tp1: 0.087949 * (1 - 0.015),
  tp2: 0.087949 * (1 - 0.03),
});
assert.equal(ok.widened, false);

console.log("OK protect-sl-reentry-smoke", {
  newSl: tight.sl,
  distPct: (((tight.sl - 0.087949) / 0.087949) * 100).toFixed(2),
});
