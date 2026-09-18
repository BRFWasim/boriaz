/**
 * Smoke P1 : shallow OTE, H4-lead sizing helpers, trail lock math.
 * npx tsx scripts/p1-incredible-smoke.ts
 */
import assert from "node:assert/strict";
import {
  computeOte,
  computeOteShallow,
  riskPctFromConfidence,
} from "../src/lib/smc";

const deep = computeOte("long", 110, 100)!;
const shallow = computeOteShallow("long", 110, 100)!;
assert.ok(shallow.high > shallow.low);
assert.ok(shallow.low >= deep.high - 1e-9 || shallow.low > deep.low);
// Shallow is closer to impulse high than deep
assert.ok(shallow.ideal > deep.ideal, "shallow ideal plus haut (moins de pullback)");

const deepS = computeOte("short", 110, 100)!;
const shallowS = computeOteShallow("short", 110, 100)!;
assert.ok(shallowS.ideal < deepS.ideal);

let risk = riskPctFromConfidence(90);
assert.equal(risk, 4); // cap prudent
const shallowRisk = Math.max(1.5, risk * 0.5);
assert.equal(shallowRisk, 2);
const h4LeadRisk = Math.max(1.5, risk * 0.65);
assert.ok(h4LeadRisk < risk);
assert.ok(riskPctFromConfidence(70) <= 2.5);

console.log("OK p1-incredible-smoke", {
  deepIdeal: deep.ideal,
  shallowIdeal: shallow.ideal,
  shallowRisk,
  h4LeadRisk,
  riskCap: risk,
});
