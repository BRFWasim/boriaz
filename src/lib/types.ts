export type Side = "long" | "short";

export type TpslKind = "sl" | "tp";

export type ExitReason = "sl" | "tp" | "trigger" | "manual";

export type SortKey =
  | "portfolio"
  | "pnl24h"
  | "positions"
  | "unrealized"
  | "risk"
  | "winrate";

export type UiMode = "simple" | "advanced";

export interface LeaderboardRow {
  ethAddress: string;
  accountValue: string;
  displayName: string | null;
  prize?: number;
  windowPerformances: [string, { pnl: string; roi: string; vlm: string }][];
}

export interface Leverage {
  type: "cross" | "isolated";
  value: number;
  rawUsd?: string;
}

export interface AssetPosition {
  type: string;
  position: {
    coin: string;
    szi: string;
    leverage: Leverage;
    entryPx: string;
    positionValue: string;
    unrealizedPnl: string;
    returnOnEquity?: string;
    liquidationPx?: string | null;
    marginUsed?: string;
    maxLeverage?: number;
    cumFunding?: {
      allTime?: string;
      sinceOpen?: string;
      sinceChange?: string;
    };
  };
}

export interface ClearinghouseState {
  marginSummary: {
    accountValue: string;
    totalNtlPos: string;
    totalRawUsd: string;
    totalMarginUsed: string;
  };
  crossMarginSummary?: {
    accountValue: string;
    totalNtlPos: string;
    totalRawUsd: string;
    totalMarginUsed: string;
  };
  crossMaintenanceMarginUsed?: string;
  withdrawable?: string;
  assetPositions: AssetPosition[];
  time?: number;
}

export interface FrontendOrder {
  coin: string;
  side: "B" | "A";
  limitPx: string;
  sz: string;
  oid: number;
  timestamp: number;
  origSz?: string;
  triggerCondition?: string;
  isTrigger?: boolean;
  triggerPx?: string;
  children?: FrontendOrder[];
  isPositionTpsl?: boolean;
  reduceOnly?: boolean;
  orderType?: string;
  tif?: string | null;
  cloid?: string | null;
  tpsl?: "tp" | "sl";
}

export interface HistoricalOrder {
  order: FrontendOrder;
  status: string;
  statusTimestamp: number;
}

export interface Fill {
  coin: string;
  px: string;
  sz: string;
  side: "A" | "B";
  time: number;
  startPosition: string;
  dir: string;
  closedPnl: string;
  oid: number;
  hash?: string;
  crossed?: boolean;
  fee?: string;
}

export interface AssetCtx {
  markPx: string;
  oraclePx?: string;
  midPx?: string;
  funding?: string;
  openInterest?: string;
  dayNtlVlm?: string;
  premium?: string;
}

export interface UniverseAsset {
  name: string;
  szDecimals?: number;
  maxLeverage?: number;
}

export interface ProtectionLevel {
  kind: TpslKind;
  price: number;
  distancePct: number;
  orderType: string;
  isPositionLevel: boolean;
}

export interface OpenPosition {
  coin: string;
  side: Side;
  qty: number;
  notionalUsd: number;
  leverage: number;
  leverageType: "cross" | "isolated";
  entryPx: number;
  markPx: number | null;
  unrealizedPnl: number;
  returnOnEquity: number | null;
  liquidationPx: number | null;
  distanceToLiqPct: number | null;
  marginUsed: number;
  fundingSinceOpen: number;
  fundingAllTime: number;
  moveFromEntryPct: number | null;
  fundingRate8h: number | null;
  openInterest: number | null;
  dayVolume: number | null;
  sl: ProtectionLevel | null;
  tp: ProtectionLevel | null;
  openedAt: number | null;
  openedAtInferred: boolean;
}

export interface ClosedPosition {
  coin: string;
  side: Side;
  qty: number;
  entryPx: number;
  exitPx: number;
  realizedPnl: number;
  openedAt: number | null;
  closedAt: number;
  exitReason: ExitReason;
}

export interface WindowStats {
  pnl: number;
  roi: number;
  volume: number;
}

export interface TradeStats {
  winRate: number | null;
  sample: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number | null;
  expectancy: number | null;
  totalRealizedSample: number;
  feesPaid: number;
}

export interface ExposureStats {
  longUsd: number;
  shortUsd: number;
  netUsd: number;
  grossUsd: number;
  longPct: number;
  shortPct: number;
  marginUsed: number;
  marginRatio: number;
  withdrawable: number;
  avgLeverage: number;
  maxLeverageUsed: number;
  unrealizedTotal: number;
  fundingOpenTotal: number;
  protectedWithSl: number;
  protectedWithTp: number;
  unprotectedCount: number;
  nearLiquidationCount: number;
  concentrationTopCoin: string | null;
  concentrationTopPct: number;
}

export interface Whale {
  address: string;
  alias: string;
  rank: number;
  leaderboardValue: number;
  portfolioUsd: number;
  day: WindowStats;
  week: WindowStats;
  month: WindowStats;
  allTime: WindowStats;
  /** @deprecated use day.pnl — conservé pour compat UI */
  pnl24h: number;
  roi24h: number | null;
  winRate: number | null;
  winSample: number;
  tradeStats: TradeStats;
  exposure: ExposureStats;
  riskScore: number;
  riskLabel: "faible" | "modéré" | "élevé" | "critique";
  bias: "long" | "short" | "neutre";
  positions: OpenPosition[];
  closed: ClosedPosition[];
  error?: string;
}

export interface CoinCrowd {
  coin: string;
  whaleCount: number;
  longUsd: number;
  shortUsd: number;
  netUsd: number;
  fundingRate8h: number | null;
}

export interface MarketOverview {
  whaleCount: number;
  totalEquity: number;
  totalGrossExposure: number;
  totalLongUsd: number;
  totalShortUsd: number;
  netBiasUsd: number;
  bias: "long" | "short" | "neutre";
  avgWinRate: number | null;
  totalUnrealized: number;
  totalPnl24h: number;
  crowded: CoinCrowd[];
  riskiest: { alias: string; address: string; riskScore: number; riskLabel: string }[];
}

export interface DashboardPayload {
  whales: Whale[];
  coins: string[];
  overview: MarketOverview;
  fetchedAt: number;
  nextRefreshSec: number;
  source: {
    leaderboard: string;
    info: string;
  };
  scanNote: string;
  cached: boolean;
}
