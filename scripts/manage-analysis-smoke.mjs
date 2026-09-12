/**
 * Smoke : vérifie qu’un trade sans TF reçoit quand même un manageSnapshot
 * (évite « Relecture en cours… » infini).
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// Compile-free check of the degraded-snapshot contract used by manageOpenTrades.
function buildDegradedSnapshot(prev) {
  const degraded = {
    at: Date.now(),
    action: "wait",
    reason: "Données TF indisponibles (HL lent/429) — PnL mid uniquement",
    price: 100,
    pnlEur: -1.5,
    pnlPct: -1.2,
    bias1h: "neutre",
    bias4h: "neutre",
    support: null,
    resistance: null,
    providers: ["mid+PnL"],
    outlook: "Surveillance dégradée : attendre le prochain scan complet.",
    side: "long",
    currency: "€",
    bullets: ["TF indisponibles — dernier avis conservé + PnL rafraîchi"],
  };
  if (prev) {
    degraded.action = prev.action;
    degraded.rawAction = prev.rawAction;
    degraded.actionSince = prev.actionSince;
    degraded.confirmCount = prev.confirmCount;
    degraded.smc = prev.smc;
    degraded.bullets = [
      "TF indisponibles — dernier avis conservé + PnL rafraîchi",
      ...(prev.bullets ?? []),
    ].slice(0, 8);
  }
  return degraded;
}

const empty = buildDegradedSnapshot(null);
assert.equal(empty.action, "wait");
assert.ok(empty.at > 0);
assert.ok(empty.providers.includes("mid+PnL"));
assert.ok(empty.reason.length > 10);

const prev = {
  action: "hold",
  rawAction: "hold",
  actionSince: 1,
  confirmCount: 2,
  smc: { against: false },
  bullets: ["déjà analysé"],
};
const kept = buildDegradedSnapshot(prev);
assert.equal(kept.action, "hold");
assert.equal(kept.confirmCount, 2);
assert.ok(kept.bullets[0].includes("TF indisponibles"));
assert.ok(kept.bullets.includes("déjà analysé"));

// Merge UI : ne pas perdre manageSnapshot si la nouvelle payload n’en a pas
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
const merged = mergePreserve(
  [{ id: "1", manageSnapshot: empty }],
  [{ id: "1", coin: "BTC", manageSnapshot: null }],
);
assert.equal(merged[0].manageSnapshot.action, "wait");
assert.equal(merged[0].coin, "BTC");

console.log("manage-analysis-smoke OK");
