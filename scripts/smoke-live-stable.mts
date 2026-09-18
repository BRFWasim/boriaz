/**
 * Smoke : stabilisation avis + extraction TP/SL HL.
 */
import assert from "node:assert/strict";
import { extractTpslFromOpenOrders } from "../src/lib/hl-live";
import { stabilizeManageAction } from "../src/lib/manage-trades";
import type { TradeManageSnapshot } from "../src/lib/user-types";

function snap(
  partial: Partial<TradeManageSnapshot> & { action: TradeManageSnapshot["action"] },
): TradeManageSnapshot {
  return {
    at: partial.at ?? Date.now() - 10_000,
    action: partial.action,
    reason: partial.reason ?? "r",
    price: 100,
    pnlEur: 1,
    pnlPct: 1,
    bias1h: "neutre",
    bias4h: "neutre",
    support: null,
    resistance: null,
    providers: ["test"],
    outlook: partial.outlook ?? "o",
    rawAction: partial.rawAction ?? partial.action,
    actionSince: partial.actionSince ?? partial.at ?? Date.now() - 10_000,
    confirmCount: partial.confirmCount ?? 1,
  };
}

{
  const tpsl = extractTpslFromOpenOrders(
    [
      {
        coin: "BTC",
        oid: 1,
        isTrigger: true,
        orderType: "Take Profit Market",
        triggerPx: "110000",
      },
      {
        coin: "BTC",
        oid: 2,
        isTrigger: true,
        orderType: "Take Profit Market",
        triggerPx: "120000",
      },
      {
        coin: "BTC",
        oid: 3,
        isTrigger: true,
        orderType: "Stop Market",
        triggerPx: "95000",
      },
      {
        coin: "ETH",
        oid: 9,
        isTrigger: true,
        orderType: "Stop Market",
        triggerPx: "1",
      },
    ],
    "BTC",
  );
  assert.equal(tpsl.sl, 95000);
  assert.equal(tpsl.tp, 120000); // TP final = plus loin du SL
  console.log("OK extractTpslFromOpenOrders");
}

{
  const prev = snap({
    action: "hold",
    rawAction: "hold",
    at: Date.now() - 20_000,
    actionSince: Date.now() - 20_000,
    confirmCount: 1,
    reason: "tenir",
    outlook: "ok",
  });
  const s1 = stabilizeManageAction({
    prev,
    next: "close",
    reason: "cloturer maintenant",
    outlook: "sortie",
  });
  assert.equal(s1.action, "hold");
  assert.equal(s1.sticky, true);
  assert.equal(s1.rawAction, "close");
  console.log("OK sticky hold vs close prematuré");

  const prev2 = {
    ...prev,
    rawAction: "close" as const,
    confirmCount: 1,
  };
  const s2 = stabilizeManageAction({
    prev: prev2,
    next: "close",
    reason: "cloturer",
    outlook: "sortie",
  });
  // encore sticky (held < 2.5min)
  assert.equal(s2.action, "hold");
  assert.ok(s2.confirmCount >= 2);
  console.log("OK confirmCount incrémente sans basculer trop tôt");
}

{
  const old = snap({
    action: "hold",
    rawAction: "close",
    at: Date.now() - 3 * 60_000,
    actionSince: Date.now() - 3 * 60_000,
    confirmCount: 2,
    reason: "tenir",
    outlook: "ok",
  });
  const s = stabilizeManageAction({
    prev: old,
    next: "close",
    reason: "cloturer confirmé",
    outlook: "sortie",
  });
  assert.equal(s.action, "close");
  assert.equal(s.sticky, false);
  console.log("OK bascule close après durée + confirms");
}

console.log("All stabilize/tpsl smoke checks passed");
