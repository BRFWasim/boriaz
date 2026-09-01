export type Side = "long" | "short";

export type TpslKind = "sl" | "tp";

export type ExitReason = "sl" | "tp" | "trigger" | "manual";

export type SortKey = "portfolio" | "pnl24h" | "positions";

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
  };
}

export interface ClearinghouseState {
  marginSummary: {
    accountValue: string;
    totalNtlPos: string;
    totalRawUsd: string;
    totalMarginUsed: string;
  };
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

export interface Whale {
  address: string;
  alias: string;
  rank: number;
  leaderboardValue: number;
  portfolioUsd: number;
  pnl24h: number;
  roi24h: number | null;
  winRate: number | null;
  winSample: number;
  positions: OpenPosition[];
  closed: ClosedPosition[];
  error?: string;
}

export interface DashboardPayload {
  whales: Whale[];
  coins: string[];
  fetchedAt: number;
  nextRefreshSec: number;
  source: {
    leaderboard: string;
    info: string;
  };
  scanNote: string;
  cached: boolean;
}
