import { parseNum } from "./format";
import {
  fetchClearinghouse,
  fetchHistoricalOrders,
  fetchLeaderboard,
  fetchMetaAndCtxs,
  fetchOpenOrders,
  fetchUserFills,
  INFO_URL,
  LEADERBOARD_URL,
  mapPool,
} from "./hyperliquid";
import {
  attachProtections,
  buildMarkMap,
  computeWinRate,
  findOpenTime,
  reconstructClosed,
  windowPerf,
} from "./positions";
import type {
  ClearinghouseState,
  DashboardPayload,
  Fill,
  FrontendOrder,
  HistoricalOrder,
  OpenPosition,
  Whale,
} from "./types";

const WHALE_COUNT = 10;
const DETAILS_TTL_MS = 20_000;
const HISTORY_TTL_MS = 60_000;
const SELECTION_TTL_MS = 10 * 60_000;
const SCAN_LIMIT = 140;
const MIN_PERP_EQUITY = 50_000;
const PROBE_CONCURRENCY = 6;
const DETAIL_CONCURRENCY = 3;

interface SelectedRow {
  address: string;
  alias: string;
  rank: number;
  leaderboardValue: number;
  pnl24h: number;
  roi24h: number;
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
  const meta = await fetchMetaAndCtxs().catch(() => ({ universe: [], ctxs: [] }));
  const marks = buildMarkMap(meta.universe, meta.ctxs);

  const whales = await mapPool(selected, DETAIL_CONCURRENCY, async (row) => {
    try {
      return await hydrateWhale(row, marks);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Erreur de chargement";
      return fallbackWhale(row, message);
    }
  });

  const coins = uniqueCoins(whales);
  const payload: DashboardPayload = {
    whales,
    coins,
    fetchedAt: Date.now(),
    nextRefreshSec: getRefreshSeconds(),
    source: {
      leaderboard: LEADERBOARD_URL,
      info: INFO_URL,
    },
    scanNote:
      "Les 10 adresses affichées sont celles du leaderboard avec le plus gros portefeuille qui ont un compte perpétuels actif (positions ouvertes ou capitaux perps). Les portefeuilles 100 % spot, sans activité perps, sont écartés. Une clôture suivie d’une nouvelle position apparaît au cycle suivant (~20 s).",
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

  for (let i = 0; i < slice.length && selected.length < WHALE_COUNT; i += PROBE_CONCURRENCY) {
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
      const day = windowPerf(item.row, "day");
      selected.push({
        address: item.row.ethAddress,
        alias: item.row.displayName?.trim() || `Baleine #${item.index + 1}`,
        rank: item.index + 1,
        leaderboardValue: parseNum(item.row.accountValue),
        pnl24h: day.pnl,
        roi24h: day.roi,
      });
    }
  }

  selected.sort((a, b) => a.rank - b.rank);
  const top = selected.slice(0, WHALE_COUNT);
  if (!top.length) {
    throw new Error(
      "Impossible d’identifier 10 baleines perps sur le leaderboard pour le moment.",
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
  marks: Map<string, number>,
): Promise<Whale> {
  const [state, orders] = await Promise.all([
    fetchClearinghouse(row.address),
    fetchOpenOrders(row.address).catch(() => [] as FrontendOrder[]),
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
      const { time, inferred } = findOpenTime(fills, position.coin, qtySigned);
      return {
        coin: position.coin,
        side,
        qty: Math.abs(qtySigned),
        notionalUsd: Math.abs(parseNum(position.positionValue)),
        leverage: position.leverage?.value ?? 0,
        leverageType: position.leverage?.type ?? "cross",
        entryPx: parseNum(position.entryPx),
        markPx: marks.get(position.coin) ?? null,
        unrealizedPnl: parseNum(position.unrealizedPnl),
        openedAt: time,
        openedAtInferred: inferred,
      };
    })
    .sort((a, b) => b.notionalUsd - a.notionalUsd);

  const positions = attachProtections(rawPositions, orders);
  const win = computeWinRate(fills);

  return {
    address: row.address,
    alias: row.alias,
    rank: row.rank,
    leaderboardValue: row.leaderboardValue,
    portfolioUsd: parseNum(state.marginSummary?.accountValue),
    pnl24h: row.pnl24h,
    roi24h: row.roi24h,
    winRate: win.rate,
    winSample: win.sample,
    positions,
    closed: reconstructClosed(fills, historical, 10),
  };
}

function fallbackWhale(row: SelectedRow, error: string): Whale {
  return {
    address: row.address,
    alias: row.alias,
    rank: row.rank,
    leaderboardValue: row.leaderboardValue,
    portfolioUsd: row.leaderboardValue,
    pnl24h: row.pnl24h,
    roi24h: row.roi24h,
    winRate: null,
    winSample: 0,
    positions: [],
    closed: [],
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
