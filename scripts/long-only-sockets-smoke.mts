/**
 * Smoke Long-only + policy côtés + mids helpers.
 */
import assert from "node:assert/strict";

{
  delete process.env.HL_ALLOW_SHORT;
  const pol = await import("../src/lib/live-side-policy");
  assert.equal(pol.isShortAllowed(), false, "défaut Long-only");
  assert.equal(pol.isLiveSideAllowed("long"), true);
  assert.equal(pol.isLiveSideAllowed("short"), false);
  assert.equal(pol.liveSidesLabel(), "long-only");

  process.env.HL_ALLOW_SHORT = "true";
  // Re-import won't re-eval module cache — call with env already set by re-reading
  // Module functions read process.env each call, so OK:
  assert.equal(pol.isShortAllowed(), true);
  assert.equal(pol.isLiveSideAllowed("short"), true);
  assert.equal(pol.liveSidesLabel(), "long+short");

  process.env.HL_ALLOW_SHORT = "false";
  assert.equal(pol.isShortAllowed(), false);
  console.log("OK live-side-policy Long-only");
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
  // Burst WS réel (réseau) — doit renvoyer mids BTC ou fallback HTTP
  const { fetchFreshMids } = await import("../src/lib/hl-mids");
  const snap = await fetchFreshMids({ preferWs: true });
  assert.ok(snap.mids && typeof snap.mids === "object");
  assert.ok(snap.source === "ws" || snap.source === "http");
  const btc = Number(snap.mids.BTC ?? snap.mids.btc ?? 0);
  assert.ok(btc > 0, `BTC mid attendu, got ${btc} via ${snap.source}`);
  console.log(`OK fetchFreshMids ${snap.source} ${snap.ms}ms BTC=${btc}`);
}

{
  // getLiveConfig expose allowShort
  process.env.HL_ALLOW_SHORT = "false";
  const { getLiveConfig } = await import("../src/lib/hl-live");
  const cfg = getLiveConfig();
  assert.equal(cfg.allowShort, false);
  console.log("OK getLiveConfig.allowShort=false");
}

console.log("All long-only + sockets smoke checks passed");
