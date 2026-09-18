/**
 * Réconciliation Hyperliquid ↔ journal / DB au démarrage.
 * Tant que reconciliation_required=true, aucune nouvelle entrée live.
 */

import { fetchLivePortfolio } from "@/lib/hl-live";
import { loadLiveJournal } from "@/lib/live-journal";
import { pgQuery, databaseUrlConfigured } from "@/lib/db/client";
import { cacheSet } from "@/lib/redis/client";
import { getRuntimeGate, updateRuntimeConfig } from "@/lib/bot/trading-mode";

export type ReconciliationReport = {
  at: string;
  ok: boolean;
  hlOk: boolean;
  hlPositions: number;
  journalOpen: number;
  unknownOnExchange: { coin: string; side: string; size: number }[];
  missingOnExchange: { coin: string; side: string; id: string }[];
  matched: number;
  message: string;
};

export async function reconcileLiveState(): Promise<ReconciliationReport> {
  const at = new Date().toISOString();
  const portfolio = await fetchLivePortfolio();
  const journal = (await loadLiveJournal()).filter((e) => e.status === "open");

  if (!portfolio.ok) {
    const report: ReconciliationReport = {
      at,
      ok: false,
      hlOk: false,
      hlPositions: 0,
      journalOpen: journal.length,
      unknownOnExchange: [],
      missingOnExchange: journal.map((j) => ({
        coin: j.coin,
        side: j.side,
        id: j.id,
      })),
      matched: 0,
      message: portfolio.reason || "Portfolio HL illisible",
    };
    await persistReconciliation(report, true);
    return report;
  }

  const hlKeys = new Map(
    portfolio.positions.map((p) => [
      `${p.coin.toUpperCase()}:${p.side}`,
      p,
    ]),
  );
  const jKeys = new Map(
    journal.map((j) => [`${j.coin.toUpperCase()}:${j.side}`, j]),
  );

  const unknownOnExchange: ReconciliationReport["unknownOnExchange"] = [];
  const missingOnExchange: ReconciliationReport["missingOnExchange"] = [];
  let matched = 0;

  for (const [k, p] of hlKeys) {
    if (jKeys.has(k)) matched += 1;
    else
      unknownOnExchange.push({
        coin: p.coin,
        side: p.side,
        size: p.size,
      });
  }
  for (const [k, j] of jKeys) {
    if (!hlKeys.has(k)) {
      missingOnExchange.push({ coin: j.coin, side: j.side, id: j.id });
    }
  }

  // Écarts = reconciliation required (sauf journal fantôme seul = warning ok)
  const hardMismatch = unknownOnExchange.length > 0;
  const ok = !hardMismatch;
  const report: ReconciliationReport = {
    at,
    ok,
    hlOk: true,
    hlPositions: portfolio.positions.length,
    journalOpen: journal.length,
    unknownOnExchange,
    missingOnExchange,
    matched,
    message: ok
      ? missingOnExchange.length
        ? `OK avec ${missingOnExchange.length} entrée(s) journal orpheline(s)`
        : "HL et journal alignés"
      : `${unknownOnExchange.length} position(s) HL inconnue(s) du journal`,
  };

  await persistReconciliation(report, !ok);
  return report;
}

async function persistReconciliation(
  report: ReconciliationReport,
  requireFlag: boolean,
): Promise<void> {
  await cacheSet("bot:last_reconciliation", JSON.stringify(report), 300);
  if (databaseUrlConfigured()) {
    try {
      await pgQuery(
        `INSERT INTO bot_events (service, event_type, severity, message, metadata_json)
         VALUES ('reconciliation', $1, $2, $3, $4::jsonb)`,
        [
          report.ok ? "reconcile_ok" : "reconcile_mismatch",
          report.ok ? "info" : "critical",
          report.message,
          JSON.stringify(report),
        ],
      );
    } catch {
      /* ignore */
    }
  }

  try {
    const gate = await getRuntimeGate();
    if (gate.reconciliationRequired !== requireFlag) {
      await updateRuntimeConfig({
        actor: "system:reconciliation",
        reconciliationRequired: requireFlag,
        reason: report.message,
      });
    }
  } catch {
    /* PG absent */
  }
}
