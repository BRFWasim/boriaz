/**
 * Hyperliquid LIVE execution — Boriaz SMC only.
 *
 * Kill-switches:
 * - HL_LIVE_ENABLED (alias HL_LIVE_ENABLED) must be "true"
 * - HL_AGENT_PRIVATE_KEY (alias HL_AGENT_PRIVATE_KEY) = agent key (NOT master seed)
 * Caps via HL_MAX_NOTIONAL_USD / HL_MAX_LEVERAGE / HL_MAX_OPEN_POSITIONS
 * Live size is also capped by real HL equity (safe for ~100 USDC accounts)
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
  /** Ignoré pour le sizing live — le live utilise 2% de l’equity HL réelle. */
  notionalUsd?: number;
  leverage: number;
  entryMode: LiveEntryMode;
  paperId?: string;
  /** Risque live en % du solde HL réel (défaut 2). */
  riskPct?: number;
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

function envFlagAny(names: string[], fallback = false): boolean {
  for (const name of names) {
    const v = process.env[name]?.trim().toLowerCase();
    if (!v) continue;
    return v === "1" || v === "true" || v === "yes" || v === "on";
  }
  return fallback;
}

function envNum(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function envNumAny(names: string[], fallback: number): number {
  for (const name of names) {
    const n = Number(process.env[name]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return fallback;
}

function envStrAny(names: string[]): string {
  for (const name of names) {
    const v = process.env[name]?.trim();
    if (v) return v;
  }
  return "";
}

function readAgentPrivateKey(): string {
  // Canonical + aliases (docs / chat sometimes used HL_AGENT_PRIVATE_KEY)
  return envStrAny([
    "HL_AGENT_PRIVATE_KEY",
    "HL_AGENT_PRIVATE_KEY",
    "HL_PRIVATE_KEY",
  ]);
}

function makeTransport(testnet: boolean) {
  return new HttpTransport({ isTestnet: testnet });
}

export function getLiveConfig(): LiveConfigStatus {
  const key = readAgentPrivateKey();
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
    envArmed: envFlagAny(["HL_LIVE_ENABLED", "HL_LIVE_ENABLED"], false),
    hasAgentKey: Boolean(key) && Boolean(agentAddress),
    testnet: envFlagAny(["HL_LIVE_TESTNET", "HL_LIVE_TESTNET"], false),
    // Défaut 80$ — adapté aux petits comptes (~100 USDC). Override via env.
    maxNotionalUsd: envNumAny(
      ["HL_MAX_NOTIONAL_USD", "HL_MAX_NOTIONAL_USD"],
      500,
    ),
    maxLeverage: Math.min(
      10,
      envNumAny(["HL_MAX_LEVERAGE", "HL_MAX_LEVERAGE"], 3),
    ),
    maxOpenPositions: Math.min(
      10,
      Math.floor(
        envNumAny(["HL_MAX_OPEN_POSITIONS", "HL_MAX_OPEN_POSITIONS"], 2),
      ),
    ),
    agentAddress,
    // OBLIGATOIRE : adresse MASTER (celle qui a les USDC), PAS l’agent API.
    // L’agent signe ; le master détient le solde (info clearinghouse).
    accountAddress:
      envStrAny(["HL_ACCOUNT_ADDRESS", "HL_ACCOUNT_ADDRESS"]).toLowerCase() ||
      null,
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
  if (!cfg.accountAddress) {
    return {
      ok: false,
      reason:
        "HL_ACCOUNT_ADDRESS manquante — mets l’adresse MASTER (celle avec tes USDC), pas l’agent API.",
    };
  }
  if (
    cfg.agentAddress &&
    cfg.accountAddress.toLowerCase() === cfg.agentAddress.toLowerCase()
  ) {
    return {
      ok: false,
      reason:
        "HL_ACCOUNT_ADDRESS = adresse agent. Remplace par l’adresse MASTER du portefeuille (~109$).",
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
  const raw = readAgentPrivateKey();
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


export type LivePositionRow = {
  coin: string;
  side: LiveSide;
  size: number;
  entryPx: number;
  positionValueUsd: number;
  unrealizedPnlUsd: number;
  leverage: number;
  marginUsedUsd: number;
};

export type LivePortfolioSnapshot = {
  ok: boolean;
  reason?: string;
  testnet: boolean;
  address: string | null;
  /** Equity utilisée pour le sizing live (perp + USDC spot Unified). */
  accountValueUsd: number;
  totalMarginUsedUsd: number;
  withdrawableUsd: number;
  totalUnrealizedPnlUsd: number;
  openPositionCount: number;
  positions: LivePositionRow[];
  perpEquityUsd?: number;
  spotUsdcUsd?: number;
};

export async function fetchLivePortfolio(): Promise<LivePortfolioSnapshot> {
  const cfg = getLiveConfig();
  const address = cfg.accountAddress;
  if (!address) {
    return {
      ok: false,
      reason:
        "HL_ACCOUNT_ADDRESS absente — adresse MASTER obligatoire (pas l’agent API).",
      testnet: cfg.testnet,
      address: null,
      accountValueUsd: 0,
      totalMarginUsedUsd: 0,
      withdrawableUsd: 0,
      totalUnrealizedPnlUsd: 0,
      openPositionCount: 0,
      positions: [],
      perpEquityUsd: 0,
      spotUsdcUsd: 0,
    };
  }
  try {
    const info = new InfoClient({ transport: makeTransport(cfg.testnet) });
    const user = address as `0x${string}`;

    // Perps + Spot (+ portfolio fallback). Unified Account : USDC souvent 100 % spot.
    const [state, spot, portfolioRows, abstraction] = await Promise.all([
      info.clearinghouseState({ user }),
      info.spotClearinghouseState({ user }).catch(() => null),
      info.portfolio({ user }).catch(() => null),
      info.userAbstraction({ user }).catch(() => null),
    ]);

    const positions: LivePositionRow[] = [];
    for (const row of state.assetPositions ?? []) {
      const p = row.position;
      const szi = Number(p?.szi ?? 0);
      if (!Number.isFinite(szi) || Math.abs(szi) <= 0) continue;
      const levRaw = p?.leverage as { value?: number } | number | undefined;
      const leverage =
        typeof levRaw === "number"
          ? levRaw
          : Number(levRaw?.value ?? 1) || 1;
      positions.push({
        coin: String(p?.coin ?? "?"),
        side: szi > 0 ? "long" : "short",
        size: Math.abs(szi),
        entryPx: Number(p?.entryPx ?? 0),
        positionValueUsd: Math.abs(Number(p?.positionValue ?? 0)),
        unrealizedPnlUsd: Number(p?.unrealizedPnl ?? 0),
        leverage,
        marginUsedUsd: Number(p?.marginUsed ?? 0),
      });
    }

    const perpEquityUsd = Math.max(
      Number(state.marginSummary?.accountValue ?? 0),
      Number(state.crossMarginSummary?.accountValue ?? 0),
      0,
    );
    const totalMarginUsedUsd = Math.max(
      Number(state.marginSummary?.totalMarginUsed ?? 0),
      Number(state.crossMarginSummary?.totalMarginUsed ?? 0),
      0,
    );
    const withdrawablePerp = Number(state.withdrawable ?? 0);

    let spotUsdcUsd = 0;
    if (spot && Array.isArray(spot.balances)) {
      for (const b of spot.balances) {
        const coin = String((b as { coin?: string }).coin ?? "");
        if (coin.toUpperCase() === "USDC") {
          const total = Number((b as { total?: string }).total ?? 0);
          if (Number.isFinite(total)) spotUsdcUsd += total;
        }
      }
    }

    let portfolioEquityUsd = 0;
    if (Array.isArray(portfolioRows)) {
      const allTime = portfolioRows.find((row) => row?.[0] === "allTime");
      const hist = allTime?.[1]?.accountValueHistory;
      if (Array.isArray(hist) && hist.length) {
        const last = Number(hist[hist.length - 1]?.[1] ?? 0);
        if (Number.isFinite(last)) portfolioEquityUsd = last;
      }
    }

    // Unified : perps souvent à 0$ tant que l’USDC reste en spot — max des sources.
    const accountValueUsd = Math.max(
      perpEquityUsd,
      spotUsdcUsd,
      portfolioEquityUsd,
    );
    const withdrawableUsd = Math.max(withdrawablePerp, spotUsdcUsd);

    let reason: string | undefined;
    if (accountValueUsd <= 0) {
      reason =
        `Solde 0$ pour ${address.slice(0, 6)}…${address.slice(-4)} ` +
        `(perp ${perpEquityUsd.toFixed(2)}$ / spot USDC ${spotUsdcUsd.toFixed(2)}$` +
        (abstraction ? ` / mode ${abstraction}` : "") +
        `). ` +
        `Vérifie que HL_ACCOUNT_ADDRESS est bien le wallet connecté à Hyperliquid (haut droite → adresse 0x…), pas l’agent.`;
    } else if (perpEquityUsd <= 0 && spotUsdcUsd > 0) {
      reason =
        `Compte Unified : ${spotUsdcUsd.toFixed(2)}$ USDC en spot (perp ${perpEquityUsd.toFixed(2)}$). ` +
        `Le live size sur ce solde (2%).`;
    }

    return {
      ok: true,
      testnet: cfg.testnet,
      address,
      accountValueUsd,
      totalMarginUsedUsd,
      withdrawableUsd,
      totalUnrealizedPnlUsd: positions.reduce(
        (s, p) => s + p.unrealizedPnlUsd,
        0,
      ),
      openPositionCount: positions.length,
      positions,
      perpEquityUsd,
      spotUsdcUsd,
      reason,
    };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : "clearinghouse HL illisible",
      testnet: cfg.testnet,
      address,
      accountValueUsd: 0,
      totalMarginUsedUsd: 0,
      withdrawableUsd: 0,
      totalUnrealizedPnlUsd: 0,
      openPositionCount: 0,
      positions: [],
      perpEquityUsd: 0,
      spotUsdcUsd: 0,
    };
  }
}

/**
 * Sizing LIVE = 2% du solde HL réel (pas le paper).
 * Le capital paper Lab n’entre pas dans ce calcul.
 * HL_MAX_NOTIONAL_USD = plafond de sécurité optionnel (pas la taille du trade).
 */
export function sizeLiveFromRealEquity(input: {
  equityUsd: number;
  freeCollateralUsd?: number;
  entry: number;
  sl: number;
  maxLeverage: number;
  maxNotionalUsd: number;
  riskPct?: number;
}): {
  ok: boolean;
  reason?: string;
  equityUsd: number;
  riskPct: number;
  riskUsd: number;
  notionalUsd: number;
  leverage: number;
  marginUsd: number;
  note?: string;
} {
  const riskPct = input.riskPct && input.riskPct > 0 ? input.riskPct : 2;
  const equityUsd = Math.max(0, input.equityUsd);
  if (!(equityUsd >= 20)) {
    return {
      ok: false,
      reason: `Equity HL trop faible (${equityUsd.toFixed(2)}$) — minimum ~20$ pour sizer à 2%.`,
      equityUsd,
      riskPct,
      riskUsd: 0,
      notionalUsd: 0,
      leverage: 1,
      marginUsd: 0,
    };
  }
  if (!(input.entry > 0 && input.sl > 0 && input.entry !== input.sl)) {
    return {
      ok: false,
      reason: "Entrée/SL invalides pour le sizing live.",
      equityUsd,
      riskPct,
      riskUsd: 0,
      notionalUsd: 0,
      leverage: 1,
      marginUsd: 0,
    };
  }

  const riskUsd = equityUsd * (riskPct / 100);
  const slDist = Math.abs(input.entry - input.sl) / input.entry;
  const dist = Math.max(0.0015, slDist); // min 0.15% pour éviter notionnel absurde
  let notional = riskUsd / dist;
  const notes: string[] = [
    `2% de ${equityUsd.toFixed(2)}$ = ${riskUsd.toFixed(2)}$ risqués`,
  ];

  let leverage = Math.min(
    input.maxLeverage,
    Math.max(1, Math.ceil(notional / (equityUsd * 0.25))),
  );
  leverage = Math.min(input.maxLeverage, Math.max(1, leverage));

  // Plafond sécurité env (optionnel) — ne définit PAS le risque 2%
  if (notional > input.maxNotionalUsd) {
    notional = input.maxNotionalUsd;
    notes.push(`plafond HL_MAX_NOTIONAL_USD ${input.maxNotionalUsd}$`);
  }

  // Ne pas consommer toute la marge disponible
  const free =
    input.freeCollateralUsd != null && input.freeCollateralUsd > 0
      ? input.freeCollateralUsd
      : equityUsd;
  const marginCap = free * 0.45;
  const notionalCap = marginCap * leverage;
  if (notional > notionalCap) {
    notional = notionalCap;
    notes.push(`marge libre ${free.toFixed(0)}$`);
  }

  const marginUsd = notional / leverage;
  if (notional < 8 || marginUsd < 2) {
    return {
      ok: false,
      reason: `Taille live trop petite (notionnel ${notional.toFixed(2)}$, marge ${marginUsd.toFixed(2)}$).`,
      equityUsd,
      riskPct,
      riskUsd,
      notionalUsd: 0,
      leverage,
      marginUsd: 0,
    };
  }

  return {
    ok: true,
    equityUsd,
    riskPct,
    riskUsd: Math.round(riskUsd * 100) / 100,
    notionalUsd: Math.round(notional * 100) / 100,
    leverage,
    marginUsd: Math.round(marginUsd * 100) / 100,
    note: notes.join(" · "),
  };
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

  if (!(req.entry > 0 && req.tp > 0 && req.sl > 0)) {
    return { ok: false, reason: "Paramètres entrée/TP/SL invalides." };
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
  const portfolio = await fetchLivePortfolio();
  if (!portfolio.ok || !(portfolio.accountValueUsd > 0)) {
    return {
      ok: false,
      skipped: true,
      reason:
        portfolio.reason ||
        "Equity HL réelle indisponible — live sizing 2% impossible.",
    };
  }
  const openN = portfolio.ok
    ? portfolio.openPositionCount
    : await countOpenPositions(cfg.testnet, user);
  if (openN >= cfg.maxOpenPositions) {
    return {
      ok: false,
      skipped: true,
      reason: `Déjà ${openN} positions ≥ cap ${cfg.maxOpenPositions}`,
    };
  }

  // LIVE size = 2% du solde HL réel (paper bankroll ignoré)
  const freeCollateral = Math.max(
    0,
    portfolio.accountValueUsd - portfolio.totalMarginUsedUsd,
  );
  const sized = sizeLiveFromRealEquity({
    equityUsd: portfolio.accountValueUsd,
    freeCollateralUsd: freeCollateral || portfolio.withdrawableUsd,
    entry: req.entry,
    sl: req.sl,
    maxLeverage: Math.min(lev, cfg.maxLeverage, asset.maxLeverage),
    maxNotionalUsd: cfg.maxNotionalUsd,
    riskPct: req.riskPct ?? 2,
  });
  if (!sized.ok) {
    return { ok: false, skipped: true, reason: sized.reason };
  }
  const notionalUsd = sized.notionalUsd;
  const liveLev = sized.leverage;

  const size = formatSz(notionalUsd / req.entry, asset.szDecimals);
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
    leverage: Math.min(liveLev, asset.maxLeverage),
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
    reason: sized.note,
    raw: result,
  };
}
