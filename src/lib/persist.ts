import { promises as fs } from "fs";
import path from "path";
import {
  DEFAULT_PREFS,
  type EntryMode,
  type JournalEntry,
  type PaperAccount,
  type PaperTrade,
  type UserPrefs,
} from "./user-types";

export type { EntryMode, JournalEntry, PaperAccount, PaperTrade, UserPrefs };
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
    status: raw.status === "open" || raw.status === "pending" ? raw.status : raw.status,
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
    const raw = JSON.parse(await fs.readFile(PAPER_FILE, "utf8")) as Partial<PaperTrade>[];
    return raw.map((t) => normalizeTrade(t as PaperTrade));
  } catch {
    return [];
  }
}

export async function savePaperTrades(trades: PaperTrade[]): Promise<void> {
  await fs.writeFile(PAPER_FILE, JSON.stringify(trades.slice(0, 120)), "utf8");
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

  // Cash = start - margins ouvertes + réalisé
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
  const sizePct = Math.max(0.5, Math.min(5, input.sizePct || 1));
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
