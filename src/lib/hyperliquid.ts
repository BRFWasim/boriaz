import type {
  ClearinghouseState,
  Fill,
  FrontendOrder,
  HistoricalOrder,
  LeaderboardRow,
} from "./types";

export const INFO_URL = "https://api.hyperliquid.xyz/info";
export const LEADERBOARD_URL =
  "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard";

const FETCH_TIMEOUT_MS = 20_000;

export class HyperliquidError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "HyperliquidError";
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeout = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timer);
  }
}

export async function postInfo<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetchWithTimeout(INFO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new HyperliquidError(
      `API info (${body.type}): HTTP ${res.status} ${text.slice(0, 180)}`,
      res.status,
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HyperliquidError(
      `API info (${body.type}): réponse non JSON (${text.slice(0, 120)})`,
    );
  }
}

export async function fetchLeaderboard(): Promise<LeaderboardRow[]> {
  try {
    const viaInfo = await postInfo<unknown>({ type: "leaderboard" });
    const rows = extractLeaderboardRows(viaInfo);
    if (rows.length) return rows;
  } catch {
    // L'endpoint info n'expose pas (encore) le type leaderboard : repli stats public.
  }

  const res = await fetchWithTimeout(LEADERBOARD_URL, { method: "GET" }, 30_000);
  if (!res.ok) {
    throw new HyperliquidError(
      `Leaderboard indisponible (HTTP ${res.status})`,
      res.status,
    );
  }
  const data = (await res.json()) as unknown;
  const rows = extractLeaderboardRows(data);
  if (!rows.length) {
    throw new HyperliquidError("Leaderboard vide ou format inattendu");
  }
  return rows;
}

function extractLeaderboardRows(data: unknown): LeaderboardRow[] {
  if (!data || typeof data !== "object") return [];
  const rec = data as Record<string, unknown>;
  const raw = rec.leaderboardRows ?? rec.leaderboard_rows;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isLeaderboardRow);
}

function isLeaderboardRow(value: unknown): value is LeaderboardRow {
  if (!value || typeof value !== "object") return false;
  const row = value as LeaderboardRow;
  return typeof row.ethAddress === "string" && typeof row.accountValue === "string";
}

export async function fetchClearinghouse(user: string): Promise<ClearinghouseState> {
  return postInfo<ClearinghouseState>({ type: "clearinghouseState", user });
}

export async function fetchOpenOrders(user: string): Promise<FrontendOrder[]> {
  try {
    const frontend = await postInfo<FrontendOrder[]>({
      type: "frontendOpenOrders",
      user,
    });
    if (Array.isArray(frontend)) return frontend;
  } catch {
    // Repli sur openOrders (sans métadonnées SL/TP).
  }
  const basic = await postInfo<FrontendOrder[]>({ type: "openOrders", user });
  return Array.isArray(basic) ? basic : [];
}

export async function fetchUserFills(user: string): Promise<Fill[]> {
  const fills = await postInfo<Fill[]>({
    type: "userFills",
    user,
    aggregateByTime: true,
  });
  return Array.isArray(fills) ? fills : [];
}

export async function fetchHistoricalOrders(user: string): Promise<HistoricalOrder[]> {
  const orders = await postInfo<HistoricalOrder[]>({
    type: "historicalOrders",
    user,
  });
  return Array.isArray(orders) ? orders : [];
}

export async function fetchMetaAndCtxs(): Promise<{
  universe: { name: string }[];
  ctxs: { markPx: string }[];
}> {
  const payload = await postInfo<[{ universe: { name: string }[] }, { markPx: string }[]]>({
    type: "metaAndAssetCtxs",
  });
  if (!Array.isArray(payload) || payload.length < 2) {
    return { universe: [], ctxs: [] };
  }
  return { universe: payload[0]?.universe ?? [], ctxs: payload[1] ?? [] };
}

export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await mapper(items[index], index);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}
