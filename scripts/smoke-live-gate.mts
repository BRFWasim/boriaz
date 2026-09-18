/**
 * Smoke gate LIVE robuste.
 */
import assert from "node:assert/strict";

function geometryOk(order: {
  side: "long" | "short";
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  entryMode: string;
}): { ok: boolean; why: string } {
  if (order.entryMode !== "limit_wait") {
    return { ok: false, why: "LIMIT obligatoire" };
  }
  const risk =
    order.side === "long" ? order.entry - order.sl : order.sl - order.entry;
  if (!(risk > 0)) return { ok: false, why: "risque ≤ 0" };
  const r1 =
    order.side === "long" ? order.tp1 - order.entry : order.entry - order.tp1;
  const r2 =
    order.side === "long" ? order.tp2 - order.entry : order.entry - order.tp2;
  if (Math.abs(r1 - risk) / risk > 0.08) return { ok: false, why: "TP1 pas 1R" };
  if (r2 + 1e-12 < risk * 1.95) return { ok: false, why: "TP2 < 2R" };
  return { ok: true, why: "ok" };
}

{
  assert.equal(
    geometryOk({
      side: "long",
      entry: 100,
      sl: 98,
      tp1: 102,
      tp2: 104,
      entryMode: "limit_wait",
    }).ok,
    true,
  );
  assert.equal(
    geometryOk({
      side: "long",
      entry: 100,
      sl: 98,
      tp1: 102,
      tp2: 103,
      entryMode: "limit_wait",
    }).ok,
    false,
  );
  assert.equal(
    geometryOk({
      side: "long",
      entry: 100,
      sl: 98,
      tp1: 102,
      tp2: 104,
      entryMode: "market_now",
    }).ok,
    false,
  );
  console.log("OK géométrie LIVE gate");
}

{
  const mod = await import("../src/lib/smc-scan");
  assert.equal(typeof mod.scanSmcWatchlist, "function");
  const gate = await import("../src/lib/smc-live-gate");
  assert.equal(typeof gate.validateLiveSmcBeforePlace, "function");
  console.log("OK exports scan + live-gate");
}

console.log("All robust gate smoke checks passed");
