/**
 * Hyperliquid LIVE execution — Boriaz SMC only.
 *
 * Kill-switches:
 * - HL_LIVE_ENABLED must be "true"
 * - HL_AGENT_PRIVATE_KEY = agent wallet key (NOT master seed)
 * Caps via HL_MAX_NOTIONAL_USD / HL_MAX_LEVERAGE / HL_MAX_OPEN_POSITIONS
 */

import {
  ExchangeClient,
  HttpTransport,
  InfoClient,
} from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";

export type LiveSide = "long" | "short";
export type LiveEntryMode = "market_now" | "limit_wait";

export type LiveTradeRequest = {
  coin: string;
  side: LiveSide;
  entry: number;
  tp: number;
  sl: number;
  notionalUsd: number;
  leverage: number;
  entryMode: LiveEntryMode;
  paperId?: string;
};

export type LiveTradeResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  coin?: string;
  assetId?: number;
  size?: string;
  entryOid?: number | null;
  tpOid?: number | null;
  slOid?: number | null;
  raw?: unknown;
};

export type LiveConfigStatus = {
  envArmed: boolean;
  hasAgentKey: boolean;
  testnet: boolean;
  maxNotionalUsd: number;
  maxLeverage: number;
  maxOpenPositions: number;
  agentAddress: string | null;
  accountAddress: string | null;
};

type AssetMeta = {
  id: number;
  name: string;
  szDecimals: number;
  maxLeverage: number;
};

let metaCache: { at: number; assets: Map<string, AssetMeta> } | null = null;

function envFlag(name: string, fallback = false): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  if (!v) return fallback;
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function envNum(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function makeTransport(testnet: boolean) {
  return new HttpTransport({ isTestnet: testnet });
}

export function getLiveConfig(): LiveConfigStatus {
  const key = process.env.HL_AGENT_PRIVATE_KEY?.trim() || "";
  let agentAddress: string | null = null;
  if (key) {
    try {
      const pk = (key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`;
      agentAddress = privateKeyToAccount(pk).address;
    } catch {
      agentAddress = null;
    }
  }
  return {
    envArmed: envFlag("HL_LIVE_ENABLED", false),
    hasAgentKey: Boolean(key) && Boolean(agentAddress),
    testnet: envFlag("HL_LIVE_TESTNET", false),
    maxNotionalUsd: envNum("HL_MAX_NOTIONAL_USD", 200),
    maxLeverage: Math.min(10, envNum("HL_MAX_LEVERAGE", 3)),
    maxOpenPositions: Math.min(
      10,
      Math.floor(envNum("HL_MAX_OPEN_POSITIONS", 2)),
    ),
    agentAddress,
    accountAddress:
      process.env.HL_ACCOUNT_ADDRESS?.trim().toLowerCase() || agentAddress,
  };
}

export function isLiveEnvReady(): { ok: boolean; reason?: string } {
  const cfg = getLiveConfig();
  if (!cfg.envArmed) {
    return {
      ok: false,
      reason: "HL_LIVE_ENABLED n’est pas true (kill-switch env).",
    };
  }
  if (!cfg.hasAgentKey) {
    return {
      ok: false,
      reason: "HL_AGENT_PRIVATE_KEY manquante ou invalide.",
    };
  }
  return { ok: true };
}

function formatPx(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  const decimals = value >= 1000 ? 1 : value >= 100 ? 2 : value >= 1 ? 3 : 5;
  const f = 10 ** decimals;
  return String(Math.round(value * f) / f);
}

function formatSz(value: number, szDecimals: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  const f = 10 ** Math.max(0, szDecimals);
  const rounded = Math.floor(value * f + 1e-12) / f;
  return rounded <= 0 ? "0" : String(rounded);
}

function aggressivePx(side: LiveSide, mid: number, entry: number): string {
  const base = mid > 0 ? mid : entry;
  return formatPx(side === "long" ? base * 1.0015 : base * 0.9985);
}

async function loadAssetMap(testnet: boolean): Promise<Map<string, AssetMeta>> {
  if (metaCache && Date.now() - metaCache.at < 60_000) return metaCache.assets;
  const info = new InfoClient({ transport: makeTransport(testnet) });
  const meta = await info.meta();
  const assets = new Map<string, AssetMeta>();
  meta.universe.forEach((u, i) => {
    if ((u as { isDelisted?: boolean }).isDelisted) return;
    assets.set(u.name.toUpperCase(), {
      id: i,
      name: u.name,
      szDecimals: u.szDecimals,
      maxLeverage: u.maxLeverage ?? 50,
    });
  });
  metaCache = { at: Date.now(), assets };
  return assets;
}

function getExchangeClient(testnet: boolean): ExchangeClient {
  const raw = process.env.HL_AGENT_PRIVATE_KEY!.trim();
  const pk = (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
  return new ExchangeClient({
    transport: makeTransport(testnet),
    wallet: privateKeyToAccount(pk),
  });
}

async function countOpenPositions(
  testnet: boolean,
  address: string,
): Promise<number> {
  const info = new InfoClient({ transport: makeTransport(testnet) });
  const state = await info.clearinghouseState({
    user: address as `0x${string}`,
  });
  return (state.assetPositions ?? []).filter((p) => {
    const s = Number(p.position?.szi ?? 0);
    return Number.isFinite(s) && Math.abs(s) > 0;
  }).length;
}

function readOid(status: unknown): number | null {
  if (!status || typeof status !== "object") return null;
  const s = status as Record<string, unknown>;
  if (s.resting && typeof s.resting === "object") {
    const oid = Number((s.resting as { oid?: number }).oid);
    return Number.isFinite(oid) ? oid : null;
  }
  if (s.filled && typeof s.filled === "object") {
    const oid = Number((s.filled as { oid?: number }).oid);
    return Number.isFinite(oid) ? oid : null;
  }
  return null;
}

/** Place entry + TP/SL reduce-only for Boriaz. */
export async function placeBoriazLiveTrade(
  req: LiveTradeRequest,
): Promise<LiveTradeResult> {
  const ready = isLiveEnvReady();
  if (!ready.ok) {
    return { ok: false, skipped: true, reason: ready.reason };
  }
  const cfg = getLiveConfig();

  if (!(req.entry > 0 && req.tp > 0 && req.sl > 0 && req.notionalUsd > 0)) {
    return { ok: false, reason: "Paramètres entrée/TP/SL/notionnel invalides." };
  }
  if (req.notionalUsd > cfg.maxNotionalUsd) {
    return {
      ok: false,
      skipped: true,
      reason: `Notionnel ${req.notionalUsd.toFixed(0)} $ > cap ${cfg.maxNotionalUsd}`,
    };
  }

  const lev = Math.min(
    Math.max(1, Math.floor(req.leverage || 1)),
    cfg.maxLeverage,
  );

  const assets = await loadAssetMap(cfg.testnet);
  const asset = assets.get(req.coin.toUpperCase());
  if (!asset) {
    return { ok: false, reason: `Coin ${req.coin} introuvable sur HL perps.` };
  }

  const user = cfg.accountAddress!;
  const openN = await countOpenPositions(cfg.testnet, user);
  if (openN >= cfg.maxOpenPositions) {
    return {
      ok: false,
      skipped: true,
      reason: `Déjà ${openN} positions ≥ cap ${cfg.maxOpenPositions}`,
    };
  }

  const size = formatSz(req.notionalUsd / req.entry, asset.szDecimals);
  if (!size || Number(size) <= 0) {
    return { ok: false, reason: "Taille calculée nulle." };
  }

  const isBuy = req.side === "long";
  const info = new InfoClient({ transport: makeTransport(cfg.testnet) });
  const mids = await info.allMids();
  const mid = Number(mids[asset.name] ?? mids[req.coin] ?? 0);

  const entryPx =
    req.entryMode === "market_now"
      ? aggressivePx(req.side, mid, req.entry)
      : formatPx(req.entry);
  const tpPx = formatPx(req.tp);
  const slPx = formatPx(req.sl);

  const client = getExchangeClient(cfg.testnet);

  await client.updateLeverage({
    asset: asset.id,
    isCross: true,
    leverage: Math.min(lev, asset.maxLeverage),
  });

  const result = await client.order({
    orders: [
      {
        a: asset.id,
        b: isBuy,
        p: entryPx,
        s: size,
        r: false,
        t: {
          limit: {
            tif: req.entryMode === "market_now" ? "FrontendMarket" : "Gtc",
          },
        },
      },
      {
        a: asset.id,
        b: !isBuy,
        p: tpPx,
        s: size,
        r: true,
        t: {
          trigger: {
            isMarket: true,
            triggerPx: tpPx,
            tpsl: "tp",
          },
        },
      },
      {
        a: asset.id,
        b: !isBuy,
        p: slPx,
        s: size,
        r: true,
        t: {
          trigger: {
            isMarket: true,
            triggerPx: slPx,
            tpsl: "sl",
          },
        },
      },
    ],
    grouping: "normalTpsl",
  });

  const statuses = result.response?.data?.statuses ?? [];
  const err = statuses.find(
    (s) => s && typeof s === "object" && "error" in s,
  ) as { error?: string } | undefined;
  if (err?.error) {
    return {
      ok: false,
      reason: err.error,
      coin: asset.name,
      assetId: asset.id,
      size,
      raw: result,
    };
  }

  return {
    ok: true,
    coin: asset.name,
    assetId: asset.id,
    size,
    entryOid: readOid(statuses[0]),
    tpOid: readOid(statuses[1]),
    slOid: readOid(statuses[2]),
    raw: result,
  };
}
