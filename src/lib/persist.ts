import { promises as fs } from "fs";
import path from "path";
import {
  DEFAULT_PREFS,
  type JournalEntry,
  type PaperTrade,
  type UserPrefs,
} from "./user-types";

export type { JournalEntry, PaperTrade, UserPrefs };
export { DEFAULT_PREFS };

const PREFS_FILE = path.join(process.cwd(), ".user-prefs.json");
const JOURNAL_FILE = path.join(process.cwd(), ".signal-journal.json");
const PAPER_FILE = path.join(process.cwd(), ".paper-trades.json");
const MACRO_ALERTS_FILE = path.join(process.cwd(), ".macro-alerts-sent.json");

export async function loadPrefs(): Promise<UserPrefs> {
  try {
    const raw = await fs.readFile(PREFS_FILE, "utf8");
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as UserPrefs) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export async function savePrefs(prefs: Partial<UserPrefs>): Promise<UserPrefs> {
  const cur = await loadPrefs();
  const next = { ...cur, ...prefs };
  await fs.writeFile(PREFS_FILE, JSON.stringify(next, null, 2), "utf8");
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
    list = JSON.parse(await fs.readFile(JOURNAL_FILE, "utf8")) as JournalEntry[];
  } catch {
    list = [];
  }
  list.unshift(full);
  list = list.slice(0, 200);
  await fs.writeFile(JOURNAL_FILE, JSON.stringify(list), "utf8");
  return full;
}

export async function readJournal(limit = 50): Promise<JournalEntry[]> {
  try {
    const list = JSON.parse(
      await fs.readFile(JOURNAL_FILE, "utf8"),
    ) as JournalEntry[];
    return list.slice(0, limit);
  } catch {
    return [];
  }
}

export async function loadPaperTrades(): Promise<PaperTrade[]> {
  try {
    return JSON.parse(await fs.readFile(PAPER_FILE, "utf8")) as PaperTrade[];
  } catch {
    return [];
  }
}

export async function savePaperTrades(trades: PaperTrade[]): Promise<void> {
  await fs.writeFile(PAPER_FILE, JSON.stringify(trades.slice(0, 100)), "utf8");
}

export async function openPaperTrade(
  input: Omit<
    PaperTrade,
    "id" | "status" | "closedAt" | "exitPx" | "pnlPct"
  >,
): Promise<PaperTrade> {
  const trades = await loadPaperTrades();
  // Évite doublons open même coin/side récents
  const exists = trades.find(
    (t) =>
      t.status === "open" &&
      t.coin === input.coin &&
      t.side === input.side &&
      Date.now() - t.openedAt < 2 * 3600_000,
  );
  if (exists) return exists;

  const trade: PaperTrade = {
    ...input,
    id: `pt-${input.openedAt}-${input.coin}`,
    status: "open",
    closedAt: null,
    exitPx: null,
    pnlPct: null,
  };
  trades.unshift(trade);
  await savePaperTrades(trades);
  return trade;
}

export async function loadMacroAlertKeys(): Promise<Set<string>> {
  try {
    const arr = JSON.parse(
      await fs.readFile(MACRO_ALERTS_FILE, "utf8"),
    ) as string[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

export async function saveMacroAlertKeys(keys: Set<string>): Promise<void> {
  await fs.writeFile(
    MACRO_ALERTS_FILE,
    JSON.stringify([...keys].slice(-200)),
    "utf8",
  );
}
