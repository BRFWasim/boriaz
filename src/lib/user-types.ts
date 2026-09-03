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
