/**
 * Smoke : paradoxe range W lower + D1 top ne doit plus geler long ET short.
 * npx tsx scripts/range-mixed-smoke.ts
 */
import assert from "node:assert/strict";
import { getMarketRangeContext, getTradeRangeGate } from "../src/lib/btc-range";

async function main() {
  const btc = await getMarketRangeContext("BTC");
  console.log("BTC", {
    price: btc.price,
    W: btc.weekly?.band,
    D1: btc.daily?.band,
    H4: btc.h4?.band,
    blockLong: btc.blockLong,
    blockShort: btc.blockShort,
    reason: btc.reason,
  });

  // Situation actuelle typique post-pump : W lower + D1 top
  if (
    btc.weekly?.band === "lower" &&
    (btc.daily?.band === "top" || btc.daily?.band === "upper")
  ) {
    assert.equal(
      btc.blockLong,
      true,
      "LONG doit rester interdit en haut de D1",
    );
    assert.equal(
      btc.blockShort,
      false,
      "SHORT ne doit plus être gelé par W lower quand D1 est haut",
    );
    const shortG = await getTradeRangeGate({
      coin: "ETH",
      side: "short",
      tradeKind: "continuation",
    });
    const longG = await getTradeRangeGate({
      coin: "ETH",
      side: "long",
      tradeKind: "continuation",
    });
    assert.equal(longG.ok, false, "gate LONG doit refuser");
    assert.equal(shortG.ok, true, "gate SHORT doit passer le range BTC");
    console.log("OK paradoxe résolu", {
      long: longG.reason.slice(0, 120),
      short: shortG.reason.slice(0, 120),
    });
  } else {
    console.log("Skip assert structurel — contexte marché différent", btc.summary);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
