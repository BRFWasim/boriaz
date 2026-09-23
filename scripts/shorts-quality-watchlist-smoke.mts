/**
 * Smoke shorts qualité + watchlist nouvelles coins.
 */
import assert from "node:assert/strict";

{
  delete process.env.HL_ALLOW_SHORT;
  const pol = await import("../src/lib/live-side-policy");
  assert.equal(pol.isShortAllowed(), true, "défaut shorts ON (qualité)");
  assert.equal(pol.isLiveSideAllowed("short"), true);
  assert.equal(pol.liveSidesLabel(), "long+short-quality");

  assert.equal(
    pol.isQualityShortSetup({
      order: { side: "short" },
      tradeKind: "continuation",
      counterTrend: false,
      h4Lead: false,
      entryStyle: "deep",
      signalType: "short_aligned",
    }),
    true,
  );
  assert.equal(
    pol.isQualityShortSetup({
      order: { side: "short" },
      tradeKind: "correction",
      counterTrend: true,
      entryStyle: "deep",
      signalType: "short_counter_trend",
    }),
    false,
  );
  assert.equal(
    pol.isQualityShortSetup({
      order: { side: "short" },
      tradeKind: "continuation",
      entryStyle: "shallow",
      signalType: "short_aligned",
    }),
    false,
  );
  assert.equal(
    pol.isQualityShortSetup({
      order: { side: "short" },
      tradeKind: "continuation",
      h4Lead: true,
      entryStyle: "deep",
      signalType: "short_aligned",
    }),
    false,
  );

  const shortCont = {
    order: { side: "short" as const },
    tradeKind: "continuation" as const,
    counterTrend: false,
    h4Lead: false,
    entryStyle: "deep" as const,
  };
  assert.equal(pol.minLiveConfidenceForSide(shortCont as never), 90);
  assert.equal(pol.minGateConfidenceForSide(shortCont as never), 88);

  const longCont = {
    order: { side: "long" as const },
    tradeKind: "continuation" as const,
    counterTrend: false,
    h4Lead: false,
    entryStyle: "deep" as const,
  };
  assert.equal(pol.minLiveConfidenceForSide(longCont as never), 82);

  process.env.HL_ALLOW_SHORT = "false";
  assert.equal(pol.isShortAllowed(), false);
  process.env.HL_ALLOW_SHORT = "true";
  console.log("OK short quality policy");
}

{
  const { WATCHLIST } = await import("../src/lib/price-watch");
  const coins = WATCHLIST.map((w) => w.coin);
  for (const c of ["BNB", "SUI", "ONDO", "PENDLE", "ASTER"]) {
    assert.ok(coins.includes(c as (typeof coins)[number]), `missing ${c}`);
  }
  const top8 = coins.slice(0, 8);
  for (const c of ["BNB", "SUI", "ONDO", "PENDLE", "ASTER"]) {
    assert.ok(top8.includes(c as (typeof coins)[number]), `${c} in top8`);
  }
  assert.ok(!coins.includes("DRV" as never));
  assert.ok(!coins.includes("BGB" as never));
  console.log("OK watchlist BNB SUI ONDO PENDLE ASTER");
}

{
  const { cryptoMeta } = await import("../src/lib/crypto-meta");
  assert.ok(cryptoMeta("BNB").label.includes("BNB") || cryptoMeta("BNB").label === "BNB");
  assert.ok(cryptoMeta("ASTER").label);
  console.log("OK crypto-meta BNB ASTER");
}

console.log("All shorts-quality + watchlist smoke checks passed");
