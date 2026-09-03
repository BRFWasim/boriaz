export interface UserPrefs {
  maxLeverage: number;
  watchCoins: string[];
  hushHoursStart: number;
  hushHoursEnd: number;
  telegramEnabled: boolean;
  paperTradeEnabled: boolean;
}

export const DEFAULT_PREFS: UserPrefs = {
  maxLeverage: 3,
  watchCoins: ["BTC", "ETH", "SOL", "UNI", "RENDER", "ONDO", "HYPE", "TAO"],
  hushHoursStart: 2,
  hushHoursEnd: 6,
  telegramEnabled: true,
  paperTradeEnabled: true,
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

export interface PaperTrade {
  id: string;
  openedAt: number;
  coin: string;
  side: "long" | "short";
  entry: number;
  tp: number;
  sl: number;
  leverage: number;
  sizePct: number;
  status: "open" | "tp" | "sl" | "closed_manual" | "invalidated";
  closedAt: number | null;
  exitPx: number | null;
  pnlPct: number | null;
  note: string;
}
