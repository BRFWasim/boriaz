/**
 * Journal des ordres LIVE — Hyperliquid ne tague pas le bot.
 * On enregistre portfolio/stratégie + TP/SL au moment du placement,
 * puis on rattache aux positions ouvertes (coin+side).
 */

import { promises as fs } from "fs";
import { dataPath, ensureDataDir } from "./data-dir";
import { kvBackend, kvGet, kvSet } from "./kv";
import { persistUserId } from "./persist";
import type { LiveSide } from "./hl-live";
import type { PortfolioStrategy, TradeManageSnapshot } from "./user-types";
import { botLabelFromPortfolio, tradeOutcomesUsd } from "./trade-outcomes";

export type LiveJournalEntry = {
  id: string;
  openedAt: number;
  closedAt: number | null;
  status: "open" | "closed";
  coin: string;
  side: LiveSide;
  entry: number;
  tp: number;
  sl: number;
  /** TP1 SMC (1R) — clôture 50% + BE comme paper. */
  tp1?: number | null;
  tp2?: number | null;
  tp1Hit?: boolean;
  size: number;
  leverage: number;
  riskPct: number;
  riskUsd: number;
  tpPnlUsd: number;
  slPnlUsd: number;
  portfolioId: string;
  portfolioName: string;
  strategy: PortfolioStrategy;
  botLabel: string;
  paperId?: string;
  entryOid?: number | null;
  tpOid?: number | null;
  slOid?: number | null;
  /** Dernière relecture (PnL / conseil) — comme paper. */
  manageSnapshot?: TradeManageSnapshot | null;
};

const mem = new Map<string, string>();

const SHARED_JOURNAL_KEY = "boriazbot:hl-live-journal";

function journalKey(): string {
  // Journal partagé : 1 wallet HL = 1 journal (cron default + UI session).
  // Sinon botLabel / Si TP-SL vides selon l’utilisateur connecté.
  return SHARED_JOURNAL_KEY;
}

function journalFile(key = journalKey()): string {
  const safe = key.replace(/[^a-zA-Z0-9._-]/g, "_");
  return dataPath(`.${safe}.json`);
}

async function readKeyRaw(key: string): Promise<string | null> {
  if (kvBackend() === "upstash") {
    const fromKv = await kvGet(key);
    if (fromKv != null) {
      mem.set(key, fromKv);
      return fromKv;
    }
  }
  try {
    const raw = await fs.readFile(journalFile(key), "utf8");
    mem.set(key, raw);
    return raw;
  } catch {
    return mem.get(key) ?? null;
  }
}

async function readRaw(): Promise<string | null> {
  const key = journalKey();
  const primary = await readKeyRaw(key);
  if (primary) return primary;

  // Migration one-shot : anciens journaux scoped user → journal partagé
  const legacyKeys = [
    `boriazbot:default:live-journal`,
    `boriazbot:${persistUserId()}:live-journal`,
  ];
  for (const legacy of legacyKeys) {
    if (legacy === key) continue;
    const raw = await readKeyRaw(legacy);
    if (!raw) continue;
    await writeRaw(raw);
    return raw;
  }
  return null;
}

async function writeRaw(raw: string): Promise<void> {
  const key = journalKey();
  mem.set(key, raw);
  if (kvBackend() === "upstash") {
    await kvSet(key, raw);
  }
  try {
    await ensureDataDir();
    await fs.writeFile(journalFile(), raw, "utf8");
  } catch {
    /* EROFS — mémoire (+ Upstash si OK) */
  }
}

export async function loadLiveJournal(): Promise<LiveJournalEntry[]> {
  try {
    const raw = await readRaw();
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LiveJournalEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveLiveJournal(
  entries: LiveJournalEntry[],
): Promise<void> {
  await writeRaw(JSON.stringify(entries.slice(-200)));
}

export async function recordLiveJournalEntry(
  input: Omit<
    LiveJournalEntry,
    "id" | "openedAt" | "closedAt" | "status" | "botLabel" | "tpPnlUsd" | "slPnlUsd"
  > & { botLabel?: string },
): Promise<LiveJournalEntry> {
  const outcomes = tradeOutcomesUsd({
    side: input.side,
    entry: input.entry,
    tp: input.tp,
    sl: input.sl,
    size: input.size,
  });
  const entry: LiveJournalEntry = {
    ...input,
    id: `lj-${Date.now()}-${input.coin}-${input.side}`,
    openedAt: Date.now(),
    closedAt: null,
    status: "open",
    botLabel:
      input.botLabel ||
      botLabelFromPortfolio({
        portfolioId: input.portfolioId,
        portfolioName: input.portfolioName,
        strategy: input.strategy,
      }),
    tpPnlUsd: outcomes.tpPnlUsd,
    slPnlUsd: outcomes.slPnlUsd,
  };

  const all = await loadLiveJournal();
  // Une seule entrée open par coin+side
  const next = all.map((e) =>
    e.status === "open" &&
    e.coin.toUpperCase() === entry.coin.toUpperCase() &&
    e.side === entry.side
      ? { ...e, status: "closed" as const, closedAt: Date.now() }
      : e,
  );
  next.push(entry);
  await saveLiveJournal(next);
  return entry;
}

/** Ferme les entrées journal plus présentes sur HL. */
export async function syncLiveJournalWithPositions(
  openPositions: { coin: string; side: LiveSide }[],
): Promise<LiveJournalEntry[]> {
  const openKeys = new Set(
    openPositions.map((p) => `${p.coin.toUpperCase()}:${p.side}`),
  );
  const all = await loadLiveJournal();
  let changed = false;
  const next = all.map((e) => {
    if (e.status !== "open") return e;
    const key = `${e.coin.toUpperCase()}:${e.side}`;
    if (openKeys.has(key)) return e;
    changed = true;
    return { ...e, status: "closed" as const, closedAt: Date.now() };
  });
  if (changed) await saveLiveJournal(next);
  return next.filter((e) => e.status === "open");
}

export function matchJournalToPosition(
  openJournal: LiveJournalEntry[],
  coin: string,
  side: LiveSide,
): LiveJournalEntry | null {
  const key = `${coin.toUpperCase()}:${side}`;
  const hits = openJournal.filter(
    (e) => `${e.coin.toUpperCase()}:${e.side}` === key,
  );
  if (!hits.length) return null;
  return hits.sort((a, b) => b.openedAt - a.openedAt)[0] ?? null;
}

/** Met à jour une entrée open (ex. TP1 hit → BE). */
export async function updateLiveJournalEntry(
  id: string,
  patch: Partial<LiveJournalEntry>,
): Promise<LiveJournalEntry | null> {
  const all = await loadLiveJournal();
  const idx = all.findIndex((e) => e.id === id);
  if (idx < 0) return null;
  const next = { ...all[idx]!, ...patch, id: all[idx]!.id };
  all[idx] = next;
  await saveLiveJournal(all);
  return next;
}
