export type TimeframeFocus = "15m" | "1h" | "4h" | "1d";

export interface PortfolioProfile {
  id: string;
  name: string;
  /** Le portefeuille Défaut ne peut pas être supprimé. */
  isDefault: boolean;
  enabled: boolean;
  paperTradeEnabled: boolean;
  bankrollEur: number;
  maxLeverage: number;
  /** % du capital engagé en marge par trade */
  sizePct: number;
  minRR: number;
  targetEur: number;
  maxLossEur: number;
  tradesPerDay: number;
  /** Horizon de trading privilégié */
  timeframe: TimeframeFocus;
  /** 1 = prudent … 5 = très risqué */
  riskLevel: number;
  requireAiGate: boolean;
  maxSafetyMode: boolean;
}

export interface TradeJustification {
  summary: string;
  bullets: string[];
  alignmentScore: number;
  aiVerified: boolean;
  aiNote: string | null;
  portfolioId: string;
  portfolioName: string;
  timeframe: TimeframeFocus;
  triggeredAt: number;
}

export interface UserPrefs {
  maxLeverage: number;
  watchCoins: string[];
  hushHoursStart: number;
  hushHoursEnd: number;
  telegramEnabled: boolean;
  paperTradeEnabled: boolean;
  /** Solde paper de départ en € (legacy / défaut) */
  paperBankrollEur: number;
  /**
   * Sureté max : Telegram UNIQUEMENT si 1h+4h alignés
   * ET crowd WR qualité (≥58 %).
   */
  maxSafetyMode: boolean;
  /** Mode perso trading Lab (legacy — migré vers portfolios) */
  customTradingMode: boolean;
  customMinRR: number;
  customTargetEur: number;
  customMaxLossEur: number;
  customTradesPerDay: number;
  /** Portefeuilles paper (toujours ≥1 défaut) */
  portfolios: PortfolioProfile[];
}

export const DEFAULT_PORTFOLIO: PortfolioProfile = {
  id: "default",
  name: "Défaut (sûr)",
  isDefault: true,
  enabled: true,
  paperTradeEnabled: true,
  bankrollEur: 1000,
  maxLeverage: 3,
  sizePct: 10,
  minRR: 1.5,
  targetEur: 200,
  maxLossEur: 150,
  tradesPerDay: 5,
  timeframe: "4h",
  riskLevel: 2,
  requireAiGate: true,
  maxSafetyMode: true,
};

export function ensurePortfolios(
  list: PortfolioProfile[] | null | undefined,
): PortfolioProfile[] {
  const incoming = Array.isArray(list) ? list : [];
  const byId = new Map<string, PortfolioProfile>();
  for (const p of incoming) {
    if (!p?.id) continue;
    byId.set(p.id, {
      ...DEFAULT_PORTFOLIO,
      ...p,
      id: p.id,
      isDefault: p.id === "default" || p.isDefault === true,
    });
  }
  if (!byId.has("default")) {
    byId.set("default", { ...DEFAULT_PORTFOLIO });
  } else {
    const d = byId.get("default")!;
    byId.set("default", { ...d, isDefault: true, enabled: true });
  }
  return [...byId.values()];
}

export function makeCustomPortfolio(
  partial?: Partial<PortfolioProfile>,
): PortfolioProfile {
  const id = partial?.id || `pf_${Date.now().toString(36)}`;
  return {
    id,
    name: partial?.name || "Perso",
    isDefault: false,
    enabled: partial?.enabled ?? true,
    paperTradeEnabled: partial?.paperTradeEnabled ?? true,
    bankrollEur: partial?.bankrollEur ?? 1000,
    maxLeverage: partial?.maxLeverage ?? 4,
    sizePct: partial?.sizePct ?? 8,
    minRR: partial?.minRR ?? 1.2,
    targetEur: partial?.targetEur ?? 150,
    maxLossEur: partial?.maxLossEur ?? 200,
    tradesPerDay: partial?.tradesPerDay ?? 8,
    timeframe: partial?.timeframe ?? "1h",
    riskLevel: partial?.riskLevel ?? 3,
    requireAiGate: partial?.requireAiGate ?? true,
    maxSafetyMode: partial?.maxSafetyMode ?? false,
  };
}

export const DEFAULT_PREFS: UserPrefs = {
  maxLeverage: 3,
  watchCoins: [
    "BTC",
    "ETH",
    "SOL",
    "UNI",
    "RENDER",
    "ONDO",
    "HYPE",
    "TAO",
    "AVAX",
    "LINK",
    "DOGE",
    "SUI",
  ],
  hushHoursStart: 2,
  hushHoursEnd: 6,
  telegramEnabled: true,
  paperTradeEnabled: true,
  paperBankrollEur: 1000,
  maxSafetyMode: true,
  customTradingMode: false,
  customMinRR: 2,
  customTargetEur: 200,
  customMaxLossEur: 100,
  customTradesPerDay: 3,
  portfolios: [{ ...DEFAULT_PORTFOLIO }],
};

export interface JournalEntry {
  id: string;
  at: number;
  coin: string;
  action: "long" | "short" | "wait" | "close";
  confidence: number;
  entry: number | null;
  tp: number | null;
  sl: number | null;
  leverage: string;
  sizePct: string;
  reason: string;
  source: string;
  portfolioId?: string;
  justification?: string;
}

export type EntryMode = "market_now" | "limit_wait";

export interface PaperTrade {
  id: string;
  /** true une fois la notif Telegram de clôture (TP/SL) envoyée. */
  closeNotified?: boolean;
  openedAt: number;
  /** Moment où le prix a touché l’entrée (limit) ou = openedAt (market). */
  filledAt: number | null;
  coin: string;
  side: "long" | "short";
  entry: number;
  tp: number;
  sl: number;
  leverage: number;
  /** % du capital paper engagé en marge (ex: 2 = 2 %). */
  sizePct: number;
  /** Marge engagée en €. */
  marginEur: number;
  /** Notionnel = marge × levier. */
  notionalEur: number;
  entryMode: EntryMode;
  status:
    | "pending"
    | "open"
    | "tp"
    | "sl"
    | "closed_manual"
    | "invalidated"
    | "expired";
  closedAt: number | null;
  exitPx: number | null;
  markPx: number | null;
  /** PnL levieré en % sur la marge. */
  pnlPct: number | null;
  /** PnL en euros (sur la marge × move × levier). */
  pnlEur: number | null;
  note: string;
  portfolioId: string;
  portfolioName: string;
  justification: TradeJustification | null;
}

export interface BookTrade {
  id: string;
  at: number;
  coin: string;
  side: "long" | "short";
  entry: number;
  tp: number;
  sl: number;
  leverage: number;
  marginEur: number;
  notionalEur: number;
  sizePct: number;
  alignment: number;
  reason: string;
  portfolioId: string;
  portfolioName: string;
  justification: TradeJustification | null;
}

export interface PaperAccount {
  bankrollStartEur: number;
  /** Cash libre + marges ouvertes (valeur mark-to-market). */
  equityEur: number;
  cashEur: number;
  marginUsedEur: number;
  realizedPnlEur: number;
  unrealizedPnlEur: number;
  openCount: number;
  pendingCount: number;
  closedCount: number;
  winCount: number;
  lossCount: number;
  portfolioId?: string;
  portfolioName?: string;
}

/**
 * Compte paper d'UN book (start = bankroll de ce book). Si `portfolioId` est
 * fourni, ne compte que les trades de ce portefeuille. Fonction pure (aucun
 * accès disque) → réutilisable côté serveur ET client pour un rendu cohérent.
 */
export function computePaperAccount(
  trades: PaperTrade[],
  bankrollStartEur = 1000,
  portfolioId?: string,
): PaperAccount {
  const scoped = portfolioId
    ? trades.filter((t) => (t.portfolioId || "default") === portfolioId)
    : trades;
  let realized = 0;
  let unrealized = 0;
  let marginUsed = 0;
  let openCount = 0;
  let pendingCount = 0;
  let closedCount = 0;
  let winCount = 0;
  let lossCount = 0;

  for (const t of scoped) {
    if (t.status === "pending") {
      pendingCount += 1;
      marginUsed += t.marginEur;
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
    portfolioId,
  };
}

/**
 * Compte GLOBAL cohérent = somme des comptes de chaque portefeuille (chacun
 * avec SA propre base de capital). Évite le bug où l'on cumulait les marges de
 * plusieurs books de 1000 € sur une seule base de 1000 € (cash négatif, PnL
 * total faux). Le total = somme des sections, exactement.
 */
export function aggregatePaperAccount(
  trades: PaperTrade[],
  portfolios: PortfolioProfile[],
): PaperAccount {
  const list = ensurePortfolios(portfolios);
  const acc: PaperAccount = {
    bankrollStartEur: 0,
    equityEur: 0,
    cashEur: 0,
    marginUsedEur: 0,
    realizedPnlEur: 0,
    unrealizedPnlEur: 0,
    openCount: 0,
    pendingCount: 0,
    closedCount: 0,
    winCount: 0,
    lossCount: 0,
  };
  const knownIds = new Set(list.map((p) => p.id));
  for (const p of list) {
    const a = computePaperAccount(trades, p.bankrollEur, p.id);
    acc.bankrollStartEur += a.bankrollStartEur;
    acc.equityEur += a.equityEur;
    acc.cashEur += a.cashEur;
    acc.marginUsedEur += a.marginUsedEur;
    acc.realizedPnlEur += a.realizedPnlEur;
    acc.unrealizedPnlEur += a.unrealizedPnlEur;
    acc.openCount += a.openCount;
    acc.pendingCount += a.pendingCount;
    acc.closedCount += a.closedCount;
    acc.winCount += a.winCount;
    acc.lossCount += a.lossCount;
  }
  // Trades orphelins (portefeuille supprimé) : rattachés au défaut pour ne pas
  // perdre leur PnL réalisé/latent dans le total.
  const orphans = trades.filter((t) => !knownIds.has(t.portfolioId || "default"));
  if (orphans.length) {
    const def = list.find((p) => p.isDefault);
    const a = computePaperAccount(orphans, 0);
    acc.equityEur += a.equityEur;
    acc.cashEur += a.cashEur;
    acc.marginUsedEur += a.marginUsedEur;
    acc.realizedPnlEur += a.realizedPnlEur;
    acc.unrealizedPnlEur += a.unrealizedPnlEur;
    acc.openCount += a.openCount;
    acc.pendingCount += a.pendingCount;
    acc.closedCount += a.closedCount;
    acc.winCount += a.winCount;
    acc.lossCount += a.lossCount;
    if (def) acc.portfolioName = def.name;
  }
  return acc;
}
