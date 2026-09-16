/**
 * Locks / reconcile / budget IA — idées extraites de docs/ARCHITECTURE + RISK
 * (branche pg-redis), adaptées au monolithe Vercel + Upstash existant.
 * Objectif : FAIRE GAGNER DE L'ARGENT — pas de double ordre, pas d’entrée aveugle.
 */

import { kvDel, kvGet, kvSet, kvSetEx, kvSetNxEx } from "./kv";

const RECONCILE_KEY = "boriaz:reconciliation_required";
const AI_HOUR_KEY = "boriaz:ai:calls:hour";
const AI_DAY_KEY = "boriaz:ai:calls:day";
const AI_FAIL_KEY = "boriaz:ai:failures";
const AI_BREAKER_KEY = "boriaz:ai:breaker";

export function liveLockKey(coin: string, side: string): string {
  return `boriaz:live-lock:${coin.toUpperCase()}:${side}`;
}

export async function acquireLiveLock(
  coin: string,
  side: string,
  ttlSec = 120,
): Promise<boolean> {
  return kvSetNxEx(liveLockKey(coin, side), String(Date.now()), ttlSec);
}

export async function releaseLiveLock(
  coin: string,
  side: string,
): Promise<void> {
  await kvDel(liveLockKey(coin, side));
}

export async function acquireManageSmcLock(ttlSec = 90): Promise<boolean> {
  return kvSetNxEx("boriaz:manage-smc-lock", String(Date.now()), ttlSec);
}

export async function releaseManageSmcLock(): Promise<void> {
  await kvDel("boriaz:manage-smc-lock");
}

export async function isReconciliationRequired(): Promise<boolean> {
  const v = await kvGet(RECONCILE_KEY);
  return v === "1" || v === "true";
}

export async function setReconciliationRequired(
  required: boolean,
  note?: string,
): Promise<void> {
  if (required) {
    await kvSet(
      RECONCILE_KEY,
      "1",
    );
    if (note) await kvSetEx("boriaz:reconciliation_note", note, 3600);
  } else {
    await kvDel(RECONCILE_KEY);
    await kvDel("boriaz:reconciliation_note");
  }
}

/**
 * Compare positions HL vs journal open.
 * Position HL sans journal → reconciliation_required (bloque nouvelles entrées LIVE).
 */
export async function reconcileLiveVsJournal(): Promise<{
  ok: boolean;
  unknownHl: string[];
  orphanJournal: string[];
  note: string;
}> {
  const { fetchLivePortfolio } = await import("./hl-live");
  const { loadLiveJournal, syncLiveJournalWithPositions } = await import(
    "./live-journal"
  );

  const portfolio = await fetchLivePortfolio();
  if (!portfolio.ok) {
    return {
      ok: false,
      unknownHl: [],
      orphanJournal: [],
      note: portfolio.reason || "Portfolio HL illisible",
    };
  }

  // Nettoie les fantômes journal d’abord
  await syncLiveJournalWithPositions(
    portfolio.positions.map((p) => ({ coin: p.coin, side: p.side })),
  );

  const journal = (await loadLiveJournal()).filter((e) => e.status === "open");
  const jKeys = new Set(
    journal.map((e) => `${e.coin.toUpperCase()}:${e.side}`),
  );
  const unknownHl: string[] = [];
  for (const p of portfolio.positions) {
    const k = `${p.coin.toUpperCase()}:${p.side}`;
    if (!jKeys.has(k)) unknownHl.push(k);
  }

  const hlKeys = new Set(
    portfolio.positions.map((p) => `${p.coin.toUpperCase()}:${p.side}`),
  );
  const orphanJournal = journal
    .filter((e) => !hlKeys.has(`${e.coin.toUpperCase()}:${e.side}`))
    .map((e) => `${e.coin.toUpperCase()}:${e.side}`);

  if (unknownHl.length) {
    await setReconciliationRequired(
      true,
      `HL sans journal: ${unknownHl.join(", ")}`,
    );
    return {
      ok: false,
      unknownHl,
      orphanJournal,
      note: `Réconciliation requise — positions HL inconnues du journal: ${unknownHl.join(", ")}. Nouvelles entrées LIVE bloquées.`,
    };
  }

  await setReconciliationRequired(false);
  return {
    ok: true,
    unknownHl: [],
    orphanJournal,
    note: orphanJournal.length
      ? `OK HL ; journal orphelin nettoyé/à surveiller: ${orphanJournal.join(", ")}`
      : "HL ↔ journal OK",
  };
}

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]?.trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Budget IA avant d’appeler ChatGPT (AI_COST_CONTROL). */
export async function canCallAi(score: number): Promise<{
  ok: boolean;
  reason: string;
}> {
  if (process.env.AI_ENABLED?.trim().toLowerCase() === "false") {
    return { ok: false, reason: "AI_ENABLED=false" };
  }
  const minScore = envInt("AI_MIN_SIGNAL_SCORE", 75);
  if (score < minScore) {
    return {
      ok: false,
      reason: `Score ${score} < AI_MIN_SIGNAL_SCORE ${minScore} — pas d’appel LLM (règles d’abord)`,
    };
  }
  const breaker = await kvGet(AI_BREAKER_KEY);
  if (breaker === "1") {
    return {
      ok: false,
      reason: "Circuit breaker IA ouvert — trop d’échecs récents",
    };
  }
  const maxHour = envInt("MAX_AI_CALLS_PER_HOUR", 60);
  const maxDay = envInt("MAX_AI_CALLS_PER_DAY", 500);
  const hour = Number((await kvGet(AI_HOUR_KEY)) || "0") || 0;
  const day = Number((await kvGet(AI_DAY_KEY)) || "0") || 0;
  if (hour >= maxHour) {
    return { ok: false, reason: `Quota IA horaire atteint (${hour}/${maxHour})` };
  }
  if (day >= maxDay) {
    return { ok: false, reason: `Quota IA journalier atteint (${day}/${maxDay})` };
  }
  return { ok: true, reason: "budget OK" };
}

export async function noteAiCall(): Promise<void> {
  const hour = Number((await kvGet(AI_HOUR_KEY)) || "0") || 0;
  const day = Number((await kvGet(AI_DAY_KEY)) || "0") || 0;
  await kvSetEx(AI_HOUR_KEY, String(hour + 1), 3600);
  await kvSetEx(AI_DAY_KEY, String(day + 1), 86400);
}

export async function noteAiFailure(): Promise<void> {
  const maxFail = envInt("AI_CIRCUIT_BREAKER_FAILURES", 5);
  const n = Number((await kvGet(AI_FAIL_KEY)) || "0") || 0;
  const next = n + 1;
  await kvSetEx(AI_FAIL_KEY, String(next), 1800);
  if (next >= maxFail) {
    await kvSetEx(AI_BREAKER_KEY, "1", 1800);
  }
}

export async function noteAiSuccess(): Promise<void> {
  await kvDel(AI_FAIL_KEY);
  await kvDel(AI_BREAKER_KEY);
}

/** Cooldown LIVE durable (survit aux cold starts Vercel). */
export async function getDurableCooldown(
  key: string,
): Promise<number> {
  const raw = await kvGet(key);
  const n = Number(raw || "0");
  return Number.isFinite(n) ? n : 0;
}

export async function setDurableCooldown(
  key: string,
  at: number,
  ttlSec: number,
): Promise<void> {
  await kvSetEx(key, String(at), ttlSec);
}
