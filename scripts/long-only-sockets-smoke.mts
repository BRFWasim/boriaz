/**
 * Smoke policy côtés + mids helpers (post Long-only → shorts qualité).
 */
import assert from "node:assert/strict";

{
  delete process.env.HL_ALLOW_SHORT;
  const pol = await import("../src/lib/live-side-policy");
  assert.equal(pol.isShortAllowed(), true, "défaut shorts qualité ON");
  assert.equal(pol.isLiveSideAllowed("long"), true);
  assert.equal(pol.isLiveSideAllowed("short"), true);
  assert.equal(pol.liveSidesLabel(), "long+short-quality");

  process.env.HL_ALLOW_SHORT = "false";
  assert.equal(pol.isShortAllowed(), false);
  assert.equal(pol.isLiveSideAllowed("short"), false);
  assert.equal(pol.liveSidesLabel(), "long-only");

  process.env.HL_ALLOW_SHORT = "true";
  assert.equal(pol.isShortAllowed(), true);
  console.log("OK live-side-policy");
}

{
  const mids = await import("../src/lib/hl-mids");
  assert.equal(typeof mids.fetchFreshMids, "function");
  assert.equal(
    mids.midFromSnapshot(
      { mids: { BTC: "100000.5" }, source: "http", ms: 1 },
      "btc",
    ),
    100000.5,
  );
  console.log("OK hl-mids helpers");
}

{
  const { fetchFreshMids } = await import("../src/lib/hl-mids");
  const snap = await fetchFreshMids({ preferWs: true });
  assert.ok(snap.mids && typeof snap.mids === "object");
  assert.ok(snap.source === "ws" || snap.source === "http");
  const btc = Number(snap.mids.BTC ?? snap.mids.btc ?? 0);
  assert.ok(btc > 0, `BTC mid attendu, got ${btc} via ${snap.source}`);
  console.log(`OK fetchFreshMids ${snap.source} ${snap.ms}ms BTC=${btc}`);
}

{
  process.env.HL_ALLOW_SHORT = "true";
  const { getLiveConfig } = await import("../src/lib/hl-live");
  const cfg = getLiveConfig();
  assert.equal(cfg.allowShort, true);
  console.log("OK getLiveConfig.allowShort=true");
}

console.log("All long-only + sockets smoke checks passed");
