import { promises as fs } from "fs";
import {
  DEFAULT_PREFS,
  ensurePortfolios,
  makeCustomPortfolio,
  computePaperAccount,
  estimateRoundTripFeesEur,
  portfolioAllowsLive,
  type EntryMode,
  type JournalEntry,
  type PaperAccount,
  type PaperTrade,
  type TradeJustification,
  type UserPrefs,
} from "./user-types";
import { dataPath, ensureDataDir } from "./data-dir";
import { kvBackend, kvGet, kvSet } from "./kv";

export type {
  EntryMode,
  JournalEntry,
  PaperAccount,
  PaperTrade,
  TradeJustification,
  UserPrefs,
};
export {
  DEFAULT_PREFS,
  DEFAULT_PORTFOLIO,
  BORIAZ_PORTFOLIO,
  ensurePortfolios,
  makeCustomPortfolio,
  computePaperAccount,
  aggregatePaperAccount,
  isScalpPortfolio,
  isRiskyPortfolio,
  portfolioAllowsLive,
  scalpLiveRiskPct,
  SCALP_LIVE_RISK_PCT_DEFAULT,
  SCALP_LIVE_RISK_PCT_MAX,
} from "./user-types";
export type {
  PortfolioProfile,
  PortfolioStrategy,
  TimeframeFocus,
} from "./user-types";

/** Fallback mémoire si /tmp et Upstash échouent. */
const mem = new Map<string, string>();

let scopedUser = "default";

export function setPersistUser(id: string | null | undefined): void {
  scopedUser = id?.trim() || "default";
}

export function persistUserId(): string {
  return scopedUser;
}

function storeKeys() {
  const u = scopedUser;
  return {
    prefs: `boriazbot:${u}:prefs`,
    journal: `boriazbot:${u}:journal`,
    paper: `boriazbot:${u}:paper`,
    book: "boriazbot:global:book",
    macro: "boriazbot:macro-alerts",
    wallets: "boriazbot:global:followed-wallets",
    walletSnap: "boriazbot:global:wallet-snap",
    legacyPaper: "boriazbot:paper",
    legacyJournal: "boriazbot:journal",
    legacyPrefs: "boriazbot:prefs",
  };
}

function fileForKey(key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9._-]/g, "_");
  return dataPath(`.${safe}.json`);
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
    const k = storeKeys();
    const raw = (await readText(k.prefs)) ?? (await readText(k.legacyPrefs));
    if (!raw) return { ...DEFAULT_PREFS, portfolios: ensurePortfolios(null) };
    const parsed = JSON.parse(raw) as UserPrefs;
    const merged = { ...DEFAULT_PREFS, ...parsed };
    // Ajoute les nouvelles cryptos défaut sans retirer celles déjà choisies.
    const watchSet = new Set([
      ...(parsed.watchCoins ?? []),
      ...DEFAULT_PREFS.watchCoins,
    ]);
    merged.watchCoins = [...watchSet];
    // Migre l’ancien mode perso vers un portefeuille si besoin
    let portfolios = ensurePortfolios(parsed.portfolios);
    if (
      parsed.customTradingMode &&
      !portfolios.some((p) => p.id !== "default")
    ) {
      portfolios = ensurePortfolios([
        ...portfolios,
        makeCustomPortfolio({
          id: "legacy-custom",
          name: "Perso (migré)",
          minRR: parsed.customMinRR ?? 2,
          targetEur: parsed.customTargetEur ?? 200,
          maxLossEur: parsed.customMaxLossEur ?? 100,
          tradesPerDay: parsed.customTradesPerDay ?? 3,
          bankrollEur: parsed.paperBankrollEur || 1000,
          maxLeverage: parsed.maxLeverage || 3,
          timeframe: "1h",
          riskLevel: 3,
        }),
      ]);
    }
    merged.portfolios = portfolios;
    merged.paperBankrollEur =
      portfolios.find((p) => p.isDefault)?.bankrollEur ||
      merged.paperBankrollEur ||
      1000;
    // Purge persistée : Risqué / non-autorisés ne doivent plus rester LIVE
    const hadForbiddenLive = (parsed.portfolios ?? []).some(
      (p) => p && Boolean(p.liveTradeEnabled) && !portfolioAllowsLive(p),
    );
    if (hadForbiddenLive) {
      try {
        await writeText(k.prefs, JSON.stringify(merged, null, 2));
      } catch {
        /* ignore */
      }
    }
    return merged;
  } catch {
    return { ...DEFAULT_PREFS, portfolios: ensurePortfolios(null) };
  }
}

export async function savePrefs(prefs: Partial<UserPrefs>): Promise<UserPrefs> {
  const cur = await loadPrefs();
  const next: UserPrefs = { ...cur, ...prefs };
  if (prefs.portfolios) {
    next.portfolios = ensurePortfolios(prefs.portfolios);
  } else {
    next.portfolios = ensurePortfolios(cur.portfolios);
  }
  const def = next.portfolios.find((p) => p.isDefault);
  if (def) next.paperBankrollEur = def.bankrollEur;
  await writeText(storeKeys().prefs, JSON.stringify(next, null, 2));
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
    const k = storeKeys();
    const raw = (await readText(k.journal)) ?? (await readText(k.legacyJournal));
    if (raw) list = JSON.parse(raw) as JournalEntry[];
  } catch {
    list = [];
  }
  list.unshift(full);
  list = list.slice(0, 200);
  await writeText(storeKeys().journal, JSON.stringify(list));
  return full;
}

export async function readJournal(limit = 50): Promise<JournalEntry[]> {
  try {
    const k = storeKeys();
    const raw = (await readText(k.journal)) ?? (await readText(k.legacyJournal));
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
  const notionalEur = raw.notionalEur ?? marginEur * leverage;
  return {
    id: raw.id,
    closeNotified: raw.closeNotified ?? false,
    feesEur: raw.feesEur ?? estimateRoundTripFeesEur(notionalEur),
    openedAt: raw.openedAt,
    filledAt: raw.filledAt ?? (raw.status === "pending" ? null : raw.openedAt),
    coin: raw.coin,
    side: raw.side,
    entry: raw.entry,
    tp: raw.tp,
    sl: raw.sl,
    tp1: raw.tp1 ?? null,
    tp2: raw.tp2 ?? null,
    tp1Hit: raw.tp1Hit ?? false,
    realizedPartialEur: raw.realizedPartialEur ?? 0,
    remainingQtyPct: raw.remainingQtyPct ?? 1,
    strategy: raw.strategy ?? "alignment",
    riskPct: raw.riskPct,
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
    portfolioId: raw.portfolioId || "default",
    portfolioName: raw.portfolioName || "Défaut (sûr)",
    justification: raw.justification ?? null,
    manageSnapshot: raw.manageSnapshot ?? null,
  };
}

export async function loadPaperTrades(): Promise<PaperTrade[]> {
  try {
    const k = storeKeys();
    const raw = (await readText(k.paper)) ?? (await readText(k.legacyPaper));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<PaperTrade>[];
    return parsed.map((t) => normalizeTrade(t as PaperTrade));
  } catch {
    return [];
  }
}

export async function savePaperTrades(trades: PaperTrade[]): Promise<void> {
  await writeText(storeKeys().paper, JSON.stringify(trades.slice(0, 120)));
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
    const prevTouch = Math.max(
      prev.closedAt ?? 0,
      prev.filledAt ?? 0,
      prev.openedAt ?? 0,
    );
    const nextTouch = Math.max(
      t.closedAt ?? 0,
      t.filledAt ?? 0,
      t.openedAt ?? 0,
    );
    // Clôture plus récente, changement de statut, ou version navigateur plus fraîche
    if (
      nextClosed > prevClosed ||
      (t.status !== prev.status && t.closedAt) ||
      (nextTouch > prevTouch &&
        !(prev.closedAt && !t.closedAt)) // ne pas rouvrir un trade déjà clôturé serveur
    ) {
      byId.set(t.id, { ...prev, ...t });
    }
  }
  const merged = [...byId.values()].sort((a, b) => b.openedAt - a.openedAt);
  await savePaperTrades(merged);
  return merged;
}

export async function openPaperTrade(input: {
  openedAt: number;
  coin: string;
  side: "long" | "short";
  entry: number;
  tp: number;
  sl: number;
  tp1?: number | null;
  tp2?: number | null;
  leverage: number;
  sizePct: number;
  entryMode: EntryMode;
  note: string;
  bankrollEur?: number;
  markPx?: number;
  portfolioId?: string;
  portfolioName?: string;
  justification?: TradeJustification | null;
  strategy?: import("./user-types").PortfolioStrategy;
  riskPct?: number;
  /** Marge forcée (sizing risque SMC). */
  marginEur?: number;
  notionalEur?: number;
}): Promise<PaperTrade | null> {
  const trades = await loadPaperTrades();
  const pfId = input.portfolioId || "default";
  const pfName = input.portfolioName || "Défaut (sûr)";
  const live = trades.filter(
    (t) =>
      (t.status === "open" || t.status === "pending") &&
      (t.portfolioId || "default") === pfId,
  );
  // Ne pas renvoyer un ancien trade (sinon le LIVE part sans nouveau paper).
  const same = live.find((t) => t.coin === input.coin && t.side === input.side);
  if (same) return null;
  const opposite = live.find((t) => t.coin === input.coin && t.side !== input.side);
  if (opposite) return null;

  const bankroll = input.bankrollEur ?? 1000;
  const sizePct = Math.max(0.5, Math.min(25, input.sizePct || 10));
  const marginEur =
    input.marginEur != null && input.marginEur > 0
      ? input.marginEur
      : (bankroll * sizePct) / 100;
  const notionalEur =
    input.notionalEur != null && input.notionalEur > 0
      ? input.notionalEur
      : marginEur * input.leverage;
  const acc = computePaperAccount(trades, bankroll, pfId);
  if (acc.cashEur < marginEur) {
    return null;
  }

  const marketNow = input.entryMode === "market_now";
  const trade: PaperTrade = {
    id: `pt-${input.openedAt}-${pfId}-${input.coin}-${input.side}`,
    openedAt: input.openedAt,
    feesEur: estimateRoundTripFeesEur(notionalEur),
    filledAt: marketNow ? input.openedAt : null,
    coin: input.coin,
    side: input.side,
    entry: input.entry,
    tp: input.tp,
    sl: input.sl,
    tp1: input.tp1 ?? null,
    tp2: input.tp2 ?? null,
    tp1Hit: false,
    realizedPartialEur: 0,
    remainingQtyPct: 1,
    strategy: input.strategy ?? "alignment",
    riskPct: input.riskPct,
    leverage: input.leverage,
    sizePct,
    marginEur,
    notionalEur,
    entryMode: input.entryMode,
    status: marketNow ? "open" : "pending",
    closedAt: null,
    exitPx: null,
    markPx: input.markPx ?? input.entry,
    pnlPct: 0,
    pnlEur: 0,
    note: input.note,
    portfolioId: pfId,
    portfolioName: pfName,
    justification: input.justification ?? null,
  };
  trades.unshift(trade);
  await savePaperTrades(trades);
  return trade;
}

/** Clôture manuelle (ou annulation d'une limite) au prix `markPx`. PnL net des frais. */
export async function closePaperTrade(
  id: string,
  markPx: number,
  reason = "Clôture manuelle",
): Promise<PaperTrade | null> {
  const trades = await loadPaperTrades();
  const t = trades.find((x) => x.id === id);
  if (!t) return null;
  if (t.status !== "open" && t.status !== "pending") return t;
  const now = Date.now();
  if (t.status === "pending") {
    t.status = "expired";
    t.closedAt = now;
    t.exitPx = null;
    t.pnlPct = 0;
    t.pnlEur = 0;
    t.closeNotified = false;
    t.note = `${reason} — limite annulée avant remplissage`;
  } else {
    const px = markPx > 0 ? markPx : (t.markPx ?? t.entry);
    const movePct =
      t.side === "long"
        ? ((px - t.entry) / t.entry) * 100
        : ((t.entry - px) / t.entry) * 100;
    const pnlPct = movePct * t.leverage;
    const grossEur = t.marginEur * (pnlPct / 100);
    const netEur = grossEur - (t.feesEur ?? 0);
    t.status = "closed_manual";
    t.closedAt = now;
    t.exitPx = px;
    t.markPx = px;
    t.pnlPct = pnlPct;
    t.pnlEur = netEur;
    t.closeNotified = false;
    t.note = `${reason} @ ${px} — net ${netEur.toFixed(2)} € (frais ${(t.feesEur ?? 0).toFixed(2)} €)`;
  }
  await savePaperTrades(trades);
  return t;
}

export async function loadMacroAlertKeys(): Promise<Set<string>> {
  try {
    const raw = await readText(storeKeys().macro);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

export async function saveMacroAlertKeys(alertKeys: Set<string>): Promise<void> {
  await writeText(storeKeys().macro, JSON.stringify([...alertKeys].slice(-200)));
}

export async function loadBook(): Promise<import("./user-types").BookTrade[]> {
  try {
    const raw = await readText(storeKeys().book);
    if (!raw) return [];
    return JSON.parse(raw) as import("./user-types").BookTrade[];
  } catch {
    return [];
  }
}

export async function followBook(bankrollEur = 1000): Promise<PaperTrade[]> {
  const book = await loadBook();
  for (const b of book.slice(0, 10)) {
    await openPaperTrade({
      openedAt: b.at,
      coin: b.coin,
      side: b.side,
      entry: b.entry,
      tp: b.tp,
      sl: b.sl,
      leverage: b.leverage,
      sizePct: b.sizePct,
      entryMode: "market_now",
      note: `Suivi carnet · ${b.reason}`.slice(0, 220),
      bankrollEur: bankrollEur || b.marginEur * 10 || 1000,
      markPx: b.entry,
      portfolioId: b.portfolioId || "default",
      portfolioName: b.portfolioName || "Défaut (sûr)",
      justification: b.justification ?? null,
    });
  }
  return loadPaperTrades();
}

export async function appendBook(
  entry: import("./user-types").BookTrade,
): Promise<import("./user-types").BookTrade[]> {
  const list = await loadBook();
  if (list.some((b) => b.id === entry.id)) return list;
  const sameOpen = list.find(
    (b) =>
      b.coin === entry.coin &&
      b.side === entry.side &&
      (b.portfolioId || "default") === (entry.portfolioId || "default") &&
      Date.now() - b.at < 6 * 3600_000,
  );
  if (sameOpen) return list;
  list.unshift({
    ...entry,
    portfolioId: entry.portfolioId || "default",
    portfolioName: entry.portfolioName || "Défaut (sûr)",
    justification: entry.justification ?? null,
  });
  await writeText(storeKeys().book, JSON.stringify(list.slice(0, 80)));
  return list.slice(0, 80);
}

export interface FollowedWallet {
  address: string;
  alias: string;
  followedAt: number;
  source: "manual" | "auto-quality";
}

export async function loadFollowedWallets(): Promise<FollowedWallet[]> {
  try {
    const raw = await readText(storeKeys().wallets);
    if (!raw) return [];
    return (JSON.parse(raw) as FollowedWallet[]).filter((w) => w.address);
  } catch {
    return [];
  }
}

export async function saveFollowedWallets(
  list: FollowedWallet[],
): Promise<FollowedWallet[]> {
  const dedup = new Map<string, FollowedWallet>();
  for (const w of list) {
    const addr = w.address.toLowerCase();
    if (!addr) continue;
    dedup.set(addr, { ...w, address: addr });
  }
  const next = [...dedup.values()].slice(0, 80);
  await writeText(storeKeys().wallets, JSON.stringify(next));
  return next;
}

export async function followWallet(
  address: string,
  alias: string,
  source: FollowedWallet["source"] = "manual",
): Promise<FollowedWallet[]> {
  const list = await loadFollowedWallets();
  const addr = address.toLowerCase();
  if (!list.some((w) => w.address === addr)) {
    list.unshift({
      address: addr,
      alias: alias || truncateAddr(addr),
      followedAt: Date.now(),
      source,
    });
  }
  return saveFollowedWallets(list);
}

export async function unfollowWallet(address: string): Promise<FollowedWallet[]> {
  const addr = address.toLowerCase();
  const list = (await loadFollowedWallets()).filter((w) => w.address !== addr);
  return saveFollowedWallets(list);
}

function truncateAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export type WalletPosSnap = Record<
  string,
  { alias: string; positions: string[]; at: number }
>;

export async function loadWalletSnap(): Promise<WalletPosSnap> {
  try {
    const raw = await readText(storeKeys().walletSnap);
    if (!raw) return {};
    return JSON.parse(raw) as WalletPosSnap;
  } catch {
    return {};
  }
}

export async function saveWalletSnap(snap: WalletPosSnap): Promise<void> {
  await writeText(storeKeys().walletSnap, JSON.stringify(snap));
}
