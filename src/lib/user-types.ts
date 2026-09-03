export interface UserPrefs {
  maxLeverage: number;
  watchCoins: string[];
  hushHoursStart: number;
  hushHoursEnd: number;
  telegramEnabled: boolean;
  paperTradeEnabled: boolean;
  /** Solde paper de départ en € */
  paperBankrollEur: number;
  /**
   * Sureté max : Telegram UNIQUEMENT si 1h+4h alignés
   * ET crowd WR qualité (≥58 %).
   */
  maxSafetyMode: boolean;
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
  status: "pending" | "open" | "tp" | "sl" | "closed_manual" | "invalidated" | "expired";
  closedAt: number | null;
  exitPx: number | null;
  markPx: number | null;
  /** PnL levieré en % sur la marge. */
  pnlPct: number | null;
  /** PnL en euros (sur la marge × move × levier). */
  pnlEur: number | null;
  note: string;
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
}
