/**
 * Smoke : un trade live sans TF doit quand même produire un manageSnapshot
 * (plus jamais « Relecture en cours… » infini).
 */
import assert from "node:assert/strict";

function buildLiveFallbackSnapshot(input) {
  const { side, price, pnlUsd, pnlPct, previous } = input;
  const sign = pnlUsd >= 0 ? "+" : "";
  const action = previous?.action ?? (pnlPct <= -8 ? "wait" : "hold");
  return {
    at: Date.now(),
    action,
    reason: (
      previous?.reason ??
      `Live ${side.toUpperCase()} · mid ${price} · PnL ${sign}${pnlUsd.toFixed(2)} $ (${sign}${pnlPct.toFixed(1)} %)`
    ).slice(0, 280),
    price,
    pnlEur: Math.round(pnlUsd * 100) / 100,
    pnlPct: Math.round(pnlPct * 100) / 100,
    bias1h: previous?.bias1h ?? "neutre",
    bias4h: previous?.bias4h ?? "neutre",
    providers: previous
      ? Array.from(new Set([...(previous.providers ?? []), "mid+PnL"]))
      : ["mid+PnL"],
    outlook: (
      previous?.outlook ??
      (pnlUsd >= 0
        ? "Position en gain — laisser courir."
        : "Position en perte — attendre confirmation multi-TF.")
    ).slice(0, 280),
    side,
    currency: "$",
    bullets: [
      `${side.toUpperCase()} live · PnL ${sign}${pnlUsd.toFixed(2)} $`,
      `Spot ~${price}`,
    ],
  };
}

function mergePreserve(prevList, nextList) {
  const byId = new Map(prevList.map((t) => [t.id, t]));
  for (const t of nextList) {
    const old = byId.get(t.id);
    byId.set(t.id, {
      ...t,
      manageSnapshot: t.manageSnapshot ?? old?.manageSnapshot ?? null,
    });
  }
  return [...byId.values()];
}

function applyLiveSnaps(positions, snaps) {
  return positions.map((p) => {
    const key = `${p.coin.toUpperCase()}:${p.side}`;
    const snap = snaps[key];
    return snap ? { ...p, manageSnapshot: snap } : p;
  });
}

const empty = buildLiveFallbackSnapshot({
  side: "long",
  price: 95000,
  pnlUsd: 12.5,
  pnlPct: 3.2,
  previous: null,
});
assert.equal(empty.action, "hold");
assert.ok(empty.at > 0);
assert.ok(empty.providers.includes("mid+PnL"));
assert.ok(empty.reason.includes("BTC") === false);
assert.ok(empty.bullets.length >= 1);
assert.equal(empty.currency, "$");

const kept = buildLiveFallbackSnapshot({
  side: "short",
  price: 100,
  pnlUsd: -5,
  pnlPct: -4,
  previous: {
    action: "hold",
    reason: "Structure OK",
    outlook: "Laisser courir",
    providers: ["règles+PnL", "SMC"],
    bias1h: "bearish",
    bias4h: "bearish",
    bullets: ["FVG tenu"],
  },
});
assert.equal(kept.action, "hold");
assert.ok(kept.providers.includes("SMC"));
assert.ok(kept.providers.includes("mid+PnL"));

const merged = mergePreserve(
  [{ id: "1", manageSnapshot: empty }],
  [{ id: "1", coin: "ETH", manageSnapshot: null }],
);
assert.equal(merged[0].manageSnapshot.action, "hold");
assert.equal(merged[0].coin, "ETH");

const liveApplied = applyLiveSnaps(
  [{ coin: "btc", side: "long", manageSnapshot: null }],
  { "BTC:long": empty },
);
assert.equal(liveApplied[0].manageSnapshot.action, "hold");
assert.ok(liveApplied[0].manageSnapshot); // pending=false

console.log("manage-analysis-smoke OK");
