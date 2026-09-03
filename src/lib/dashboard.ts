import {
  biasFromNet,
  buildMarketMaps,
  buildOverview,
  computeExposure,
  computeTradeStats,
  distanceToLiquidationPct,
  emptyExposure,
  emptyTradeStats,
  fullWindow,
  moveFromEntryPct,
  scoreRisk,
} from "./analysis";
import { buildPriorityAlerts, detectCrowdFlows } from "./crowd-flow";
import { parseNum } from "./format";
import {
  fetchClearinghouse,
  fetchHistoricalOrders,
  fetchLeaderboard,
  fetchMetaAndCtxs,
  fetchOpenOrders,
  fetchSpotClearinghouse,
  fetchSpotMetaAndCtxs,
  fetchUserFills,
  INFO_URL,
  LEADERBOARD_URL,
  mapPool,
} from "./hyperliquid";
import { getIntegrationStatus } from "./integrations";
import { fetchNansenSnapshot } from "./nansen";
import { attachProtections, reconstructClosed } from "./positions";
import { getWatchlistSnapshot, runPriceWatch } from "./price-watch";
import {
  baseAssetFromCoin,
  buildSpotHoldings,
  buildSpotMarkMap,
  detectHedgeAlerts,
  extractSpotEvents,
} from "./spot";
import type {
  ClearinghouseState,
  DashboardPayload,
  Fill,
  FrontendOrder,
  HistoricalOrder,
  OpenPosition,
  Whale,
  WindowStats,
} from "./types";

const WHALE_COUNT = 18;
const DETAILS_TTL_MS = 20_000;
const HISTORY_TTL_MS = 60_000;
const SELECTION_TTL_MS = 10 * 60_000;
const SCAN_LIMIT = 280;
const MIN_PERP_EQUITY = 50_000;
const PROBE_CONCURRENCY = 6;
const DETAIL_CONCURRENCY = 3;
const CLOSED_LIMIT = 16;

interface SelectedRow {
  address: string;
  alias: string;
  rank: number;
  leaderboardValue: number;
  day: WindowStats;
  week: WindowStats;
  month: WindowStats;
  allTime: WindowStats;
}

interface CacheBox<T> {
  at: number;
  value: T;
}

let selectionCache: CacheBox<SelectedRow[]> | null = null;
let detailsCache: CacheBox<DashboardPayload> | null = null;
let inflight: Promise<DashboardPayload> | null = null;
const historyCache = new Map<
  string,
  CacheBox<{ keys: string; fills: Fill[]; historical: HistoricalOrder[] }>
>();

export function getRefreshSeconds(): number {
  return Math.round(DETAILS_TTL_MS / 1000);
}

export async function getWhaleDashboard(): Promise<DashboardPayload> {
  const now = Date.now();
  if (detailsCache && now - detailsCache.at < DETAILS_TTL_MS) {
    return { ...detailsCache.value, cached: true };
  }
  if (inflight) return inflight;
  inflight = refreshDashboard().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function refreshDashboard(): Promise<DashboardPayload> {
  const selected = await selectWhales();
  const [meta, spotMeta] = await Promise.all([
    fetchMetaAndCtxs().catch(() => ({ universe: [], ctxs: [] })),
    fetchSpotMetaAndCtxs().catch(() => ({ ctxs: [] })),
  ]);
  const maps = buildMarketMaps(meta.universe, meta.ctxs);
  const spotMarks = buildSpotMarkMap(spotMeta.ctxs, maps.marks);

  const [whalesRaw, nansen] = await Promise.all([
    mapPool(selected, DETAIL_CONCURRENCY, async (row) => {
      try {
        return await hydrateWhale(row, maps, spotMarks);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Erreur de chargement";
        return fallbackWhale(row, message);
      }
    }),
    fetchNansenSnapshot().catch(() => null),
  ]);

  const nansenByAddr = new Map<string, string>();
  if (nansen) {
    for (const row of nansen.leaderboard) {
      if (row.address && row.label) {
        nansenByAddr.set(row.address.toLowerCase(), row.label);
      }
    }
    for (const t of nansen.recentPerpTrades) {
      if (t.address && t.label && !nansenByAddr.has(t.address.toLowerCase())) {
        nansenByAddr.set(t.address.toLowerCase(), t.label);
      }
    }
  }

  const whales = whalesRaw.map((w) => ({
    ...w,
    nansenLabel: nansenByAddr.get(w.address.toLowerCase()) ?? null,
  }));

  const coins = uniqueCoins(whales);
  const overview = buildOverview(whales);
  const alerts = whales.flatMap((whale) => whale.alerts);
  const crowdFlows = detectCrowdFlows(whales);
  const priorityAlerts = buildPriorityAlerts({ hedgeAlerts: alerts, crowdFlows });
  overview.crowdShortCount = crowdFlows.filter((f) => f.side === "short").length;
  overview.crowdLongCount = crowdFlows.filter((f) => f.side === "long").length;
  overview.priorityAlertCount = priorityAlerts.length;

  let liveQuotes: DashboardPayload["liveQuotes"] = [];
  try {
    await runPriceWatch();
    const snap = await getWatchlistSnapshot();
    liveQuotes = snap.quotes.map((q) => ({
      coin: q.coin,
      label: q.label,
      price: q.price,
      change15mPct: q.change15mPct,
      change1hPct: q.change1hPct,
      change2hPct: q.change2hPct,
    }));
  } catch {
    liveQuotes = [];
  }

  const payload: DashboardPayload = {
    whales,
    coins,
    overview,
    alerts,
    crowdFlows,
    priorityAlerts,
    liveQuotes,
    integrations: getIntegrationStatus(),
    fetchedAt: Date.now(),
    nextRefreshSec: getRefreshSeconds(),
    source: {
      leaderboard: LEADERBOARD_URL,
      info: INFO_URL,
    },
    scanNote:
      `Scan élargi ~${SCAN_LIMIT} wallets HL → top ${WHALE_COUNT} perps actifs. Crowd = WR≥55 %, sample≥8, equity≥80k$. Labels Nansen collés quand l’adresse matche. Pas un conseil financier.`,
    cached: false,
  };
  detailsCache = { at: Date.now(), value: payload };
  return payload;
}

async function selectWhales(): Promise<SelectedRow[]> {
  const now = Date.now();
  if (selectionCache && now - selectionCache.at < SELECTION_TTL_MS) {
    return selectionCache.value;
  }

  const rows = await fetchLeaderboard();
  const ranked = [...rows].sort(
    (a, b) => parseNum(b.accountValue) - parseNum(a.accountValue),
  );

  const selected: SelectedRow[] = [];
  const slice = ranked.slice(0, SCAN_LIMIT);

  for (
    let i = 0;
    i < slice.length && selected.length < WHALE_COUNT;
    i += PROBE_CONCURRENCY
  ) {
    const batch = slice.slice(i, i + PROBE_CONCURRENCY);
    const probed = await Promise.all(
      batch.map(async (row, offset) => {
        try {
          const state = await fetchClearinghouse(row.ethAddress);
          return { row, state, index: i + offset };
        } catch {
          return null;
        }
      }),
    );
    for (const item of probed) {
      if (!item || selected.length >= WHALE_COUNT) continue;
      if (!isActivePerpTrader(item.state)) continue;
      selected.push({
        address: item.row.ethAddress,
        alias: item.row.displayName?.trim() || `Baleine #${item.index + 1}`,
        rank: item.index + 1,
        leaderboardValue: parseNum(item.row.accountValue),
        day: fullWindow(item.row, "day"),
        week: fullWindow(item.row, "week"),
        month: fullWindow(item.row, "month"),
        allTime: fullWindow(item.row, "allTime"),
      });
    }
  }

  selected.sort((a, b) => a.rank - b.rank);
  const top = selected.slice(0, WHALE_COUNT);
  if (!top.length) {
    throw new Error(
      `Impossible d’identifier ${WHALE_COUNT} baleines perps sur le leaderboard pour le moment.`,
    );
  }
  selectionCache = { at: Date.now(), value: top };
  return top;
}

function isActivePerpTrader(state: ClearinghouseState): boolean {
  const equity = parseNum(state.marginSummary?.accountValue);
  const open = (state.assetPositions ?? []).some(
    (item) => Math.abs(parseNum(item.position?.szi)) > 0,
  );
  return open || equity >= MIN_PERP_EQUITY;
}

function openPositionKeys(state: ClearinghouseState): string {
  return (state.assetPositions ?? [])
    .filter((item) => Math.abs(parseNum(item.position?.szi)) > 0)
    .map(
      (item) =>
        `${item.position.coin}:${Math.sign(parseNum(item.position.szi))}`,
    )
    .sort()
    .join("|");
}

async function loadFills(
  address: string,
  keys: string,
): Promise<{ fills: Fill[]; historical: HistoricalOrder[] }> {
  const cached = historyCache.get(address);
  if (
    cached &&
    cached.value.keys === keys &&
    Date.now() - cached.at < HISTORY_TTL_MS
  ) {
    return cached.value;
  }

  const [fills, historical] = await Promise.all([
    fetchUserFills(address).catch(() => [] as Fill[]),
    fetchHistoricalOrders(address).catch(() => [] as HistoricalOrder[]),
  ]);
  const value = { keys, fills, historical };
  historyCache.set(address, { at: Date.now(), value });
  return value;
}

async function hydrateWhale(
  row: SelectedRow,
  maps: ReturnType<typeof buildMarketMaps>,
  spotMarks: Map<string, number>,
): Promise<Whale> {
  const [state, orders, spotState] = await Promise.all([
    fetchClearinghouse(row.address),
    fetchOpenOrders(row.address).catch(() => [] as FrontendOrder[]),
    fetchSpotClearinghouse(row.address).catch(() => ({ balances: [] })),
  ]);
  const { fills, historical } = await loadFills(
    row.address,
    openPositionKeys(state),
  );

  const rawPositions = (state.assetPositions ?? [])
    .map((item) => item.position)
    .filter((position) => Math.abs(parseNum(position.szi)) > 0)
    .map((position) => {
      const qtySigned = parseNum(position.szi);
      const side: OpenPosition["side"] = qtySigned > 0 ? "long" : "short";
      const markPx = maps.marks.get(position.coin) ?? null;
      const entryPx = parseNum(position.entryPx);
      const liquidationPxRaw = position.liquidationPx;
      const liquidationPx =
        liquidationPxRaw === null || liquidationPxRaw === undefined
          ? null
          : parseNum(liquidationPxRaw) || null;
      const { time, inferred } = findOpenTimeLocal(fills, position.coin, qtySigned);
      return {
        coin: position.coin,
        baseAsset: baseAssetFromCoin(position.coin),
        side,
        qty: Math.abs(qtySigned),
        notionalUsd: Math.abs(parseNum(position.positionValue)),
        leverage: position.leverage?.value ?? 0,
        leverageType: position.leverage?.type ?? "cross",
        entryPx,
        markPx,
        unrealizedPnl: parseNum(position.unrealizedPnl),
        returnOnEquity:
          position.returnOnEquity !== undefined
            ? parseNum(position.returnOnEquity)
            : null,
        liquidationPx,
        distanceToLiqPct: distanceToLiquidationPct(side, markPx, liquidationPx),
        marginUsed: parseNum(position.marginUsed),
        fundingSinceOpen: parseNum(position.cumFunding?.sinceOpen),
        fundingAllTime: parseNum(position.cumFunding?.allTime),
        moveFromEntryPct: moveFromEntryPct(side, entryPx, markPx),
        fundingRate8h: maps.funding.has(position.coin)
          ? maps.funding.get(position.coin)!
          : null,
        openInterest: maps.openInterest.get(position.coin) ?? null,
        dayVolume: maps.dayVolume.get(position.coin) ?? null,
        openedAt: time,
        openedAtInferred: inferred,
      };
    })
    .sort((a, b) => b.notionalUsd - a.notionalUsd);

  const positions = attachProtections(rawPositions, orders);
  const spot = buildSpotHoldings(spotState.balances, spotMarks, fills);
  const spotBuys = extractSpotEvents(fills).filter((e) => e.dir === "Buy").slice(0, 20);
  const alerts = detectHedgeAlerts(
    { address: row.address, alias: row.alias },
    positions,
    spot,
  );
  const tradeStats = computeTradeStats(fills);
  const equity = parseNum(state.marginSummary?.accountValue);
  const marginUsed = parseNum(state.marginSummary?.totalMarginUsed);
  const withdrawable = parseNum(state.withdrawable);
  const exposure = computeExposure(positions, {
    marginUsed,
    equity,
    withdrawable,
  });
  const risk = scoreRisk(exposure, positions.length);
  const bias = biasFromNet(exposure.netUsd, exposure.grossUsd);
  const spotValueUsd = spot.reduce((acc, item) => acc + item.valueUsd, 0);

  return {
    address: row.address,
    alias: row.alias,
    rank: row.rank,
    leaderboardValue: row.leaderboardValue,
    portfolioUsd: equity,
    day: row.day,
    week: row.week,
    month: row.month,
    allTime: row.allTime,
    pnl24h: row.day.pnl,
    roi24h: row.day.roi,
    winRate: tradeStats.winRate,
    winSample: tradeStats.sample,
    tradeStats,
    exposure,
    riskScore: risk.score,
    riskLabel: risk.label,
    bias,
    positions,
    closed: reconstructClosed(fills, historical, CLOSED_LIMIT),
    spot,
    spotBuys,
    alerts,
    spotValueUsd,
    nansenLabel: null,
  };
}

function findOpenTimeLocal(
  fills: Fill[],
  coin: string,
  signedQty: number,
): { time: number | null; inferred: boolean } {
  const sign = Math.sign(signedQty);
  if (sign === 0) return { time: null, inferred: false };
  const coinFills = fills
    .filter((fill) => {
      if (fill.coin !== coin) return false;
      if (fill.coin.startsWith("@")) return false;
      const dir = fill.dir ?? "";
      return dir !== "Buy" && dir !== "Sell";
    })
    .sort((a, b) => b.time - a.time);
  if (!coinFills.length) return { time: null, inferred: false };
  let openTime = coinFills[0].time;
  let foundBoundary = false;
  for (const fill of coinFills) {
    openTime = fill.time;
    const start = parseNum(fill.startPosition);
    if (Math.abs(start) < 1e-10 || Math.sign(start) !== sign) {
      foundBoundary = true;
      break;
    }
  }
  if (!foundBoundary) return { time: null, inferred: false };
  return { time: openTime, inferred: true };
}

function fallbackWhale(row: SelectedRow, error: string): Whale {
  return {
    address: row.address,
    alias: row.alias,
    rank: row.rank,
    leaderboardValue: row.leaderboardValue,
    portfolioUsd: row.leaderboardValue,
    day: row.day,
    week: row.week,
    month: row.month,
    allTime: row.allTime,
    pnl24h: row.day.pnl,
    roi24h: row.day.roi,
    winRate: null,
    winSample: 0,
    tradeStats: emptyTradeStats(),
    exposure: emptyExposure(),
    riskScore: 0,
    riskLabel: "faible",
    bias: "neutre",
    positions: [],
    closed: [],
    spot: [],
    spotBuys: [],
    alerts: [],
    spotValueUsd: 0,
    nansenLabel: null,
    error,
  };
}

function uniqueCoins(whales: Whale[]): string[] {
  const set = new Set<string>();
  for (const whale of whales) {
    for (const position of whale.positions) set.add(position.coin);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}
