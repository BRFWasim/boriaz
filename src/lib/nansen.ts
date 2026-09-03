const BASE = "https://api.nansen.ai/api/v1";

export interface NansenSmartFlow {
  symbol: string;
  chain: string;
  netFlow24hUsd: number;
  netFlow7dUsd: number;
  traderCount: number;
  marketCapUsd: number | null;
}

export interface NansenPerpTrade {
  label: string;
  address: string;
  symbol: string;
  side: string;
  action: string;
  valueUsd: number;
  priceUsd: number;
  at: string;
}

export interface NansenLeaderRow {
  address: string;
  label: string;
  totalPnl: number;
  roi: number;
  accountValue: number;
  volumeUsd: number;
  topCoin: string | null;
  topSide: string | null;
  topValueUsd: number | null;
}

export interface NansenSnapshot {
  enabled: boolean;
  error: string | null;
  smartFlows: NansenSmartFlow[];
  recentPerpTrades: NansenPerpTrade[];
  leaderboard: NansenLeaderRow[];
  fetchedAt: number;
}

function getKey(): string | null {
  return process.env.NANSEN_API_KEY?.trim() || null;
}

async function nansenPost<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const key = getKey();
  if (!key) throw new Error("NANSEN_API_KEY manquante");
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = (await res.json()) as T & { message?: string; error?: string };
  if (!res.ok) {
    throw new Error(
      (json as { message?: string }).message ||
        (json as { error?: string }).error ||
        `Nansen HTTP ${res.status}`,
    );
  }
  return json;
}

let cache: { at: number; value: NansenSnapshot } | null = null;
const TTL = 3 * 60_000;

export async function fetchNansenSnapshot(): Promise<NansenSnapshot> {
  if (!getKey()) {
    return {
      enabled: false,
      error: "NANSEN_API_KEY manquante",
      smartFlows: [],
      recentPerpTrades: [],
      leaderboard: [],
      fetchedAt: Date.now(),
    };
  }
  if (cache && Date.now() - cache.at < TTL) return cache.value;

  const errors: string[] = [];
  let smartFlows: NansenSmartFlow[] = [];
  let recentPerpTrades: NansenPerpTrade[] = [];
  let leaderboard: NansenLeaderRow[] = [];

  try {
    const json = await nansenPost<{ data?: Record<string, unknown>[] }>(
      "/smart-money/netflow",
      { chains: ["ethereum", "solana", "base"] },
    );
    smartFlows = (json.data ?? [])
      .map((row) => ({
        symbol: String(row.token_symbol ?? ""),
        chain: String(row.chain ?? ""),
        netFlow24hUsd: Number(row.net_flow_24h_usd ?? 0),
        netFlow7dUsd: Number(row.net_flow_7d_usd ?? 0),
        traderCount: Number(row.trader_count ?? 0),
        marketCapUsd:
          row.market_cap_usd != null ? Number(row.market_cap_usd) : null,
      }))
      .filter((r) => r.symbol)
      .slice(0, 12);
  } catch (e) {
    errors.push(e instanceof Error ? e.message : "netflow");
  }

  try {
    const json = await nansenPost<{ data?: Record<string, unknown>[] }>(
      "/smart-money/perp-trades",
      { pagination: { page: 1, per_page: 24 } },
    );
    recentPerpTrades = (json.data ?? []).map((row) => ({
      label: String(row.trader_address_label ?? "Trader"),
      address: String(row.trader_address ?? ""),
      symbol: String(row.token_symbol ?? ""),
      side: String(row.side ?? ""),
      action: String(row.action ?? ""),
      valueUsd: Number(row.value_usd ?? 0),
      priceUsd: Number(row.price_usd ?? 0),
      at: String(row.block_timestamp ?? ""),
    }));
  } catch (e) {
    errors.push(e instanceof Error ? e.message : "perp-trades");
  }

  try {
    const to = new Date();
    const from = new Date(Date.now() - 7 * 86400_000);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const json = await nansenPost<{ data?: Record<string, unknown>[] }>(
      "/perp-leaderboard",
      {
        date: { from: iso(from), to: iso(to) },
        pagination: { page: 1, per_page: 12 },
        order_by: [{ field: "total_pnl", direction: "DESC" }],
      },
    );
    leaderboard = (json.data ?? []).map((row) => {
      const tops = Array.isArray(row.top_positions)
        ? (row.top_positions as Record<string, unknown>[])
        : [];
      const top = tops[0];
      return {
        address: String(row.trader_address ?? ""),
        label: String(row.trader_address_label ?? "HL Whale"),
        totalPnl: Number(row.total_pnl ?? 0),
        roi: Number(row.roi ?? 0),
        accountValue: Number(row.account_value ?? 0),
        volumeUsd: Number(row.volume_usd ?? 0),
        topCoin: top ? String(top.coin ?? "") : null,
        topSide: top ? String(top.side ?? "") : null,
        topValueUsd: top ? Number(top.position_value_usd ?? 0) : null,
      };
    });
  } catch (e) {
    errors.push(e instanceof Error ? e.message : "leaderboard");
  }

  const value: NansenSnapshot = {
    enabled: true,
    error: errors.length ? errors.join(" · ") : null,
    smartFlows,
    recentPerpTrades,
    leaderboard,
    fetchedAt: Date.now(),
  };
  cache = { at: Date.now(), value };
  return value;
}
