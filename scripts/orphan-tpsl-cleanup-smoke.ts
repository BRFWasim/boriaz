/**
 * Smoke : logique orphan TP/SL — protectif sans position doit être nettoyable.
 * npx tsx scripts/orphan-tpsl-cleanup-smoke.ts
 */
import assert from "node:assert/strict";
import { isProtectiveOpenOrder } from "../src/lib/hl-live";

const sl = {
  isTrigger: true,
  reduceOnly: true,
  orderType: "Stop Market",
};
const tp = {
  isTrigger: true,
  reduceOnly: true,
  orderType: "Take Profit Market",
};
const entryLimit = {
  isTrigger: false,
  reduceOnly: false,
  orderType: "Limit",
};

assert.equal(isProtectiveOpenOrder(sl), true);
assert.equal(isProtectiveOpenOrder(tp), true);
assert.equal(isProtectiveOpenOrder(entryLimit), false);

// Règle d’existence : sans position → cancel protectif (branch cleanup)
const posCoins = new Set<string>(["DOGE"]);
const orphans = [
  { coin: "BTC", ...sl },
  { coin: "PENDLE", ...sl },
  { coin: "DOGE", ...tp },
  { coin: "SOL", ...entryLimit },
].filter((o) => !posCoins.has(o.coin) && isProtectiveOpenOrder(o));

assert.deepEqual(
  orphans.map((o) => o.coin).sort(),
  ["BTC", "PENDLE"],
);

console.log("OK orphan-tpsl-cleanup-smoke", { cancel: orphans.map((o) => o.coin) });
