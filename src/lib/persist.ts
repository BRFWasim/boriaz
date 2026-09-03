import { promises as fs } from "fs";
import {
  DEFAULT_PREFS,
  type EntryMode,
  type JournalEntry,
  type PaperAccount,
  type PaperTrade,
  type UserPrefs,
} from "./user-types";
import { dataPath, ensureDataDir } from "./data-dir";
import { kvBackend, kvGet, kvSet } from "./kv";

export type { EntryMode, JournalEntry, PaperAccount, PaperTrade, UserPrefs };
export { DEFAULT_PREFS };

/** Fallback mémoire si /tmp et Upstash échouent. */
const mem = new Map<string, string>();

const KEYS = {
  prefs: "boriazbot:prefs",
  journal: "boriazbot:journal",
  paper: "boriazbot:paper",
  macro: "boriazbot:macro-alerts",
} as const;

function prefsFile() {
  return dataPath(".user-prefs.json");
}
function journalFile() {
  return dataPath(".signal-journal.json");
}
function paperFile() {
  return dataPath(".paper-trades.json");
}
function macroAlertsFile() {
  return dataPath(".macro-alerts-sent.json");
}

function fileForKey(key: string): string {
  if (key === KEYS.prefs) return prefsFile();
  if (key === KEYS.journal) return journalFile();
  if (key === KEYS.paper) return paperFile();
  return macroAlertsFile();
}

async function readText(key: string): Promise<string | null> {
  // 1) Upstash si dispo
  if (kvBackend() === "upstash") {
    const fromKv = await kvGet(key);
    if (fromKv != null) {
      mem.set(key, fromKv);
      return fromKv;
    }
  }
  // 2) Fichier /tmp
  const file = fileForKey(key);
  try {
    const raw = await fs.readFile(file, "utf8");
    mem.set(key, raw);
    return raw;
  } catch {
    return mem.get(key) ?? null;
  }
}

async function writeText(key: string, raw: string): Promise<void> {
  mem.set(key, raw);
  if (kvBackend() === "upstash") {
    await kvSet(key, raw);
  }
  try {
    await ensureDataDir();
    await fs.writeFile(fileForKey(key), raw, "utf8");
  } catch {
    // EROFS : mémoire (+ Upstash si OK)
  }
}

export function storageInfo(): { backend: "upstash" | "tmp"; note: string } {
  const backend = kvBackend();
  return {
    backend,
    note:
      backend === "upstash"
        ? "Paper/journal persistants via Upstash KV."
        : "Sans UPSTASH_REDIS_REST_* : paper/journal en /tmp (éphémère sur Vercel).",
  };
}

export async function loadPrefs(): Promise<UserPrefs> {
  try {
    const raw = await readText(KEYS.prefs);
    if (!raw) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as UserPrefs) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export async function savePrefs(prefs: Partial<UserPrefs>): Promise<UserPrefs> {
  const cur = await loadPrefs();
  const next = { ...cur, ...prefs };
  await writeText(KEYS.prefs, JSON.stringify(next, null, 2));
  return next;
}

export function inHushHours(prefs: UserPrefs, now = new Date()): boolean {
  const h = now.getUTCHours();
  if (prefs.hushHoursStart === prefs.hushHoursEnd) return false;
  if (prefs.hushHoursStart < prefs.hushHoursEnd) {
    return h >= prefs.hushHoursStart && h < prefs.hushHoursEnd;
  }
  return h >= prefs.hushHoursStart || h < prefs.hushHoursEnd;
}

export async function appendJournal(
  entry: Omit<JournalEntry, "id">,
): Promise<JournalEntry> {
  const full: JournalEntry = {
    ...entry,
    id: `${entry.at}-${entry.coin}-${entry.action}`,
  };
  let list: JournalEntry[] = [];
  try {
    const raw = await readText(KEYS.journal);
    if (raw) list = JSON.parse(raw) as JournalEntry[];
  } catch {
    list = [];
  }
  list.unshift(full);
  list = list.slice(0, 200);
  await writeText(KEYS.journal, JSON.stringify(list));
  return full;
}

export async function readJournal(limit = 50): Promise<JournalEntry[]> {
  try {
    const raw = await readText(KEYS.journal);
    if (!raw) return [];
    return (JSON.parse(raw) as JournalEntry[]).slice(0, limit);
  } catch {
    return [];
  }
}

function normalizeTrade(raw: Partial<PaperTrade> & PaperTrade): PaperTrade {
  const sizePct = raw.sizePct || 1;
  const leverage = raw.leverage || 1;
  const bankroll = 1000;
  const marginEur = raw.marginEur ?? (bankroll * sizePct) / 100;
  return {
    id: raw.id,
    openedAt: raw.openedAt,
    filledAt: raw.filledAt ?? (raw.status === "pending" ? null : raw.openedAt),
    coin: raw.coin,
    side: raw.side,
    entry: raw.entry,
    tp: raw.tp,
    sl: raw.sl,
    leverage,
    sizePct,
    marginEur,
    notionalEur: raw.notionalEur ?? marginEur * leverage,
    entryMode: raw.entryMode ?? "market_now",
    status:
      raw.status === "open" || raw.status === "pending" ? raw.status : raw.status,
    closedAt: raw.closedAt ?? null,
    exitPx: raw.exitPx ?? null,
    markPx: raw.markPx ?? null,
    pnlPct: raw.pnlPct ?? null,
    pnlEur: raw.pnlEur ?? null,
    note: raw.note || "",
  };
}

export async function loadPaperTrades(): Promise<PaperTrade[]> {
  try {
    const raw = await readText(KEYS.paper);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<PaperTrade>[];
    return parsed.map((t) => normalizeTrade(t as PaperTrade));
  } catch {
    return [];
  }
}

export async function savePaperTrades(trades: PaperTrade[]): Promise<void> {
  await writeText(KEYS.paper, JSON.stringify(trades.slice(0, 120)));
}

/** Fusionne un backup navigateur / autre instance (ids uniques). */
export async function mergePaperTrades(
  incoming: PaperTrade[],
): Promise<PaperTrade[]> {
  const cur = await loadPaperTrades();
  const byId = new Map<string, PaperTrade>();
  for (const t of cur) byId.set(t.id, normalizeTrade(t));
  for (const raw of incoming) {
    const t = normalizeTrade(raw as PaperTrade);
    const prev = byId.get(t.id);
    if (!prev) {
      byId.set(t.id, t);
      continue;
    }
    const prevClosed = prev.closedAt ?? 0;
    const nextClosed = t.closedAt ?? 0;
    if (nextClosed > prevClosed || (t.status !== prev.status && t.closedAt)) {
      byId.set(t.id, t);
    }
  }
  const merged = [...byId.values()].sort((a, b) => b.openedAt - a.openedAt);
  await savePaperTrades(merged);
  return merged;
}

export function computePaperAccount(
  trades: PaperTrade[],
  bankrollStartEur = 1000,
): PaperAccount {
  let realized = 0;
  let unrealized = 0;
  let marginUsed = 0;
  let openCount = 0;
  let pendingCount = 0;
  let closedCount = 0;
  let winCount = 0;
  let lossCount = 0;

  for (const t of trades) {
    if (t.status === "pending") {
      pendingCount += 1;
      continue;
    }
    if (t.status === "open") {
      openCount += 1;
      marginUsed += t.marginEur;
      unrealized += t.pnlEur ?? 0;
      continue;
    }
    closedCount += 1;
    const pnl = t.pnlEur ?? 0;
    realized += pnl;
    if (pnl > 0) winCount += 1;
    else if (pnl < 0) lossCount += 1;
  }

  const cashEur = bankrollStartEur - marginUsed + realized;
  const equityEur = cashEur + marginUsed + unrealized;

  return {
    bankrollStartEur,
    equityEur,
    cashEur,
    marginUsedEur: marginUsed,
    realizedPnlEur: realized,
    unrealizedPnlEur: unrealized,
    openCount,
    pendingCount,
    closedCount,
    winCount,
    lossCount,
  };
}

export async function openPaperTrade(input: {
  openedAt: number;
  coin: string;
  side: "long" | "short";
  entry: number;
  tp: number;
  sl: number;
  leverage: number;
  sizePct: number;
  entryMode: EntryMode;
  note: string;
  bankrollEur?: number;
  markPx?: number;
}): Promise<PaperTrade> {
  const trades = await loadPaperTrades();
  const exists = trades.find(
    (t) =>
      (t.status === "open" || t.status === "pending") &&
      t.coin === input.coin &&
      t.side === input.side &&
      Date.now() - t.openedAt < 2 * 3600_000,
  );
  if (exists) return exists;

  const bankroll = input.bankrollEur ?? 1000;
  const sizePct = Math.max(0.5, Math.min(25, input.sizePct || 10));
  const marginEur = (bankroll * sizePct) / 100;
  const marketNow = input.entryMode === "market_now";
  const trade: PaperTrade = {
    id: `pt-${input.openedAt}-${input.coin}-${input.side}`,
    openedAt: input.openedAt,
    filledAt: marketNow ? input.openedAt : null,
    coin: input.coin,
    side: input.side,
    entry: input.entry,
    tp: input.tp,
    sl: input.sl,
    leverage: input.leverage,
    sizePct,
    marginEur,
    notionalEur: marginEur * input.leverage,
    entryMode: input.entryMode,
    status: marketNow ? "open" : "pending",
    closedAt: null,
    exitPx: null,
    markPx: input.markPx ?? input.entry,
    pnlPct: 0,
    pnlEur: 0,
    note: input.note,
  };
  trades.unshift(trade);
  await savePaperTrades(trades);
  return trade;
}

export async function loadMacroAlertKeys(): Promise<Set<string>> {
  try {
    const raw = await readText(KEYS.macro);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

export async function saveMacroAlertKeys(keys: Set<string>): Promise<void> {
  await writeText(KEYS.macro, JSON.stringify([...keys].slice(-200)));
}
