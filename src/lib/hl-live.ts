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
import { formatPrice, formatSize } from "@nktkas/hyperliquid/utils";
import { privateKeyToAccount } from "viem/accounts";

export type LiveSide = "long" | "short";
export type LiveEntryMode = "market_now" | "limit_wait";

export type LiveTradeRequest = {
  coin: string;
  side: LiveSide;
  entry: number;
  tp: number;
  sl: number;
  /** Ignoré pour le sizing live — le live suit le % paper sur l’equity HL réelle. */
  notionalUsd?: number;
  leverage: number;
  entryMode: LiveEntryMode;
  paperId?: string;
  /** Risque live en % du solde HL réel (défaut 2) si pas de ratio paper. */
  riskPct?: number;
  /**
   * Miroir paper→live : marge paper / bankroll paper.
   * Appliqué au solde HL réel (même fraction engagée).
   */
  paperMarginEur?: number;
  paperBankrollEur?: number;
  /** Si true : assouplit caps/seuils — un paper Boriaz doit tenter le live. */
  mirrorPaper?: boolean;
  /** Portefeuille / bot qui a déclenché l’ordre (Boriaz, Scalp, Défaut…). */
  portfolioId?: string;
  portfolioName?: string;
  strategy?: "alignment" | "smc";
  /** TP1 SMC (1R) — 50% + BE comme paper. */
  tp1?: number | null;
  tp2?: number | null;
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
  riskUsd?: number;
  tpPnlUsd?: number;
  slPnlUsd?: number;
  botLabel?: string;
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

/**
 * Prix HL valides : ≤5 sig figs + ≤ (6 - szDecimals) décimales (perps).
 * L’ancien arrondi « 1 décimale si ≥1000 » cassait BTC (tick = 1$).
 */
function formatPx(value: number, szDecimals: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  try {
    return formatPrice(value, szDecimals, "perp");
  } catch {
    // Secours : prix >100k → entier (toujours accepté par HL)
    if (value > 100_000) return String(Math.round(value));
    const maxDec = Math.max(0, 6 - szDecimals);
    const f = 10 ** maxDec;
    const n = Math.round(value * f) / f;
    return n > 0 ? String(n) : "0";
  }
}

function formatSz(value: number, szDecimals: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  try {
    return formatSize(value, szDecimals);
  } catch {
    const f = 10 ** Math.max(0, szDecimals);
    const rounded = Math.floor(value * f + 1e-12) / f;
    return rounded <= 0 ? "0" : String(rounded);
  }
}

function aggressivePx(
  side: LiveSide,
  mid: number,
  entry: number,
  szDecimals: number,
): string {
  const base = mid > 0 ? mid : entry;
  return formatPx(
    side === "long" ? base * 1.0015 : base * 0.9985,
    szDecimals,
  );
}

function hlErrMessage(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return String(e || "Erreur Hyperliquid");
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

export type LiveExchangeTpsl = {
  coin: string;
  tp: number | null;
  sl: number | null;
  tpOid: number | null;
  slOid: number | null;
  orderCount: number;
};

function isTpOrderType(orderType: string): boolean {
  return /take\s*profit/i.test(orderType) || /\btp\b/i.test(orderType);
}

function isSlOrderType(orderType: string): boolean {
  return /stop/i.test(orderType) && !/take\s*profit/i.test(orderType);
}

/** Extrait TP/SL réels depuis les ordres trigger HL (source de vérité). */
export function extractTpslFromOpenOrders(
  opens: Array<{
    coin?: string;
    oid?: number;
    isTrigger?: boolean;
    isPositionTpsl?: boolean;
    reduceOnly?: boolean;
    orderType?: string;
    triggerPx?: string | number;
    limitPx?: string | number;
  }>,
  coin: string,
): LiveExchangeTpsl {
  const c = coin.toUpperCase();
  const forCoin = opens.filter(
    (o) => String(o.coin || "").toUpperCase() === c,
  );
  const tps = forCoin
    .filter((o) => isTpOrderType(String(o.orderType || "")))
    .map((o) => ({
      px: Number(o.triggerPx || o.limitPx || 0),
      oid: Number(o.oid) || null,
    }))
    .filter((x) => x.px > 0);
  const sls = forCoin
    .filter((o) => {
      const ot = String(o.orderType || "");
      return (
        isSlOrderType(ot) ||
        (Boolean(o.isTrigger || o.isPositionTpsl) && !isTpOrderType(ot))
      );
    })
    .map((o) => ({
      px: Number(o.triggerPx || o.limitPx || 0),
      oid: Number(o.oid) || null,
    }))
    .filter((x) => x.px > 0);

  let tp: number | null = null;
  let sl: number | null = null;
  let tpOid: number | null = null;
  let slOid: number | null = null;

  if (sls.length) {
    sl = sls[0]!.px;
    slOid = sls[0]!.oid;
  }
  if (tps.length) {
    // SMC : 2 TP possibles → afficher le TP final (le plus éloigné du SL / entry)
    const ref = sl ?? tps[0]!.px;
    tps.sort((a, b) => Math.abs(b.px - ref) - Math.abs(a.px - ref));
    tp = tps[0]!.px;
    tpOid = tps[0]!.oid;
  }

  return {
    coin: c,
    tp,
    sl,
    tpOid,
    slOid,
    orderCount: forCoin.length,
  };
}

/** Charge les TP/SL ouverts sur HL pour un compte. */
export async function fetchLiveExchangeTpslMap(): Promise<
  Record<string, LiveExchangeTpsl>
> {
  const cfg = getLiveConfig();
  if (!cfg.accountAddress) return {};
  try {
    const info = new InfoClient({ transport: makeTransport(cfg.testnet) });
    const opens = await info.frontendOpenOrders({
      user: cfg.accountAddress as `0x${string}`,
    });
    const byCoin = new Map<string, typeof opens>();
    for (const o of opens ?? []) {
      const c = String(o.coin || "").toUpperCase();
      if (!c) continue;
      const arr = byCoin.get(c) ?? [];
      arr.push(o);
      byCoin.set(c, arr);
    }
    const out: Record<string, LiveExchangeTpsl> = {};
    for (const [coin, list] of byCoin) {
      out[coin] = extractTpslFromOpenOrders(list, coin);
    }
    return out;
  } catch (e) {
    console.info("fetchLiveExchangeTpslMap", e);
    return {};
  }
}

/** True si l’ordre HL est un TP/SL trigger (pas une limit entrée). */
export function isProtectiveOpenOrder(o: {
  isTrigger?: boolean;
  isPositionTpsl?: boolean;
  reduceOnly?: boolean;
  orderType?: string;
}): boolean {
  const ot = String(o.orderType || "");
  return (
    Boolean(o.isTrigger) ||
    Boolean(o.isPositionTpsl) ||
    isTpOrderType(ot) ||
    isSlOrderType(ot) ||
    (Boolean(o.reduceOnly) && /stop|take\s*profit/i.test(ot))
  );
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
  /** Rattaché via journal live (HL ne fournit pas le bot). */
  botLabel?: string | null;
  portfolioId?: string | null;
  portfolioName?: string | null;
  strategy?: "alignment" | "smc" | null;
  tp?: number | null;
  sl?: number | null;
  tpPnlUsd?: number | null;
  slPnlUsd?: number | null;
  riskUsd?: number | null;
  paperId?: string | null;
  /** TP/SL lus sur les ordres trigger HL (source de vérité exchange). */
  exchangeTp?: number | null;
  exchangeSl?: number | null;
  /** true si position ouverte sans TP ni SL sur HL. */
  nakedTpsl?: boolean;
  /** journal | exchange | paper | none */
  tpslSource?: "journal" | "exchange" | "paper" | "none" | null;
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
 * Sizing LIVE sur le solde HL réel.
 * - Mode miroir paper : même % de marge que le paper (marge/bankroll) sur l’equity réelle.
 * - Sinon : riskPct % de l’equity (défaut 2%).
 * Seuils assouplis en mirrorPaper pour coller au paper même sur petit solde.
 */
export function sizeLiveFromRealEquity(input: {
  equityUsd: number;
  freeCollateralUsd?: number;
  entry: number;
  sl: number;
  maxLeverage: number;
  maxNotionalUsd: number;
  riskPct?: number;
  paperMarginEur?: number;
  paperBankrollEur?: number;
  mirrorPaper?: boolean;
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
  const mirror = Boolean(input.mirrorPaper);
  const minEquity = mirror ? 5 : 20;
  const minNotional = mirror ? 1 : 8;
  const minMargin = mirror ? 0.5 : 2;
  const freeFrac = mirror ? 0.85 : 0.45;

  const riskPct = input.riskPct && input.riskPct > 0 ? input.riskPct : 2;
  const equityUsd = Math.max(0, input.equityUsd);
  if (!(equityUsd >= minEquity)) {
    return {
      ok: false,
      reason: `Equity HL trop faible (${equityUsd.toFixed(2)}$) — minimum ~${minEquity}$.`,
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

  const notes: string[] = [];
  let leverage = Math.min(input.maxLeverage, Math.max(1, input.maxLeverage));
  let notional = 0;
  let riskUsd = equityUsd * (riskPct / 100);
  let effectiveRiskPct = riskPct;

  const paperMargin = Number(input.paperMarginEur);
  const paperBankroll = Number(input.paperBankrollEur);
  if (
    mirror &&
    Number.isFinite(paperMargin) &&
    paperMargin > 0 &&
    Number.isFinite(paperBankroll) &&
    paperBankroll > 0
  ) {
    // Même fraction de capital engagée en marge que le paper
    const marginFrac = Math.min(0.5, Math.max(0.002, paperMargin / paperBankroll));
    let marginUsd = equityUsd * marginFrac;
    leverage = Math.min(
      input.maxLeverage,
      Math.max(1, Math.floor(input.maxLeverage) || 1),
    );
    notional = marginUsd * leverage;
    riskUsd = marginUsd; // marge engagée (proxy)
    effectiveRiskPct = marginFrac * 100;
    notes.push(
      `miroir paper ${(marginFrac * 100).toFixed(2)}% marge · ${marginUsd.toFixed(2)}$ sur ${equityUsd.toFixed(2)}$ HL`,
    );
  } else {
    const slDist = Math.abs(input.entry - input.sl) / input.entry;
    const dist = Math.max(0.0015, slDist);
    notional = riskUsd / dist;
    notes.push(
      `${riskPct}% de ${equityUsd.toFixed(2)}$ = ${riskUsd.toFixed(2)}$ risqués`,
    );
    leverage = Math.min(
      input.maxLeverage,
      Math.max(1, Math.ceil(notional / (equityUsd * 0.25))),
    );
    leverage = Math.min(input.maxLeverage, Math.max(1, leverage));
  }

  // Plafond sécurité env (optionnel)
  if (notional > input.maxNotionalUsd) {
    notional = input.maxNotionalUsd;
    notes.push(`plafond HL_MAX_NOTIONAL_USD ${input.maxNotionalUsd}$`);
  }

  const free =
    input.freeCollateralUsd != null && input.freeCollateralUsd > 0
      ? input.freeCollateralUsd
      : equityUsd;
  const marginCap = free * freeFrac;
  const notionalCap = marginCap * leverage;
  if (notional > notionalCap) {
    notional = notionalCap;
    notes.push(`marge libre ${free.toFixed(0)}$`);
  }

  const marginUsd = notional / Math.max(1, leverage);
  if (notional < minNotional || marginUsd < minMargin) {
    return {
      ok: false,
      reason: `Taille live trop petite (notionnel ${notional.toFixed(2)}$, marge ${marginUsd.toFixed(2)}$).`,
      equityUsd,
      riskPct: effectiveRiskPct,
      riskUsd,
      notionalUsd: 0,
      leverage,
      marginUsd: 0,
    };
  }

  return {
    ok: true,
    equityUsd,
    riskPct: effectiveRiskPct,
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

  // Modes shadow/paper + kill switch + Redis/PG — jamais d’entrée live par défaut
  try {
    const { assertLiveEntryAllowed } = await import("./bot/trading-mode");
    const gate = await assertLiveEntryAllowed();
    if (!gate.allowed) {
      return {
        ok: false,
        skipped: true,
        reason: `LIVE bloqué (${gate.mode}): ${gate.reasons.join(" · ")}`,
      };
    }
  } catch (e) {
    return {
      ok: false,
      skipped: true,
      reason: `Gate live indisponible: ${e instanceof Error ? e.message : "error"}`,
    };
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
  const mirror = Boolean(req.mirrorPaper);
  const portfolio = await fetchLivePortfolio();
  if (!portfolio.ok || !(portfolio.accountValueUsd > 0)) {
    return {
      ok: false,
      skipped: true,
      reason:
        portfolio.reason ||
        "Equity HL réelle indisponible — live sizing impossible.",
    };
  }
  const openN = portfolio.ok
    ? portfolio.openPositionCount
    : await countOpenPositions(cfg.testnet, user);
  // Miroir paper Boriaz : cap soft modéré (pas 8 aveugle).
  const softCap = mirror
    ? Math.max(cfg.maxOpenPositions, Math.min(4, cfg.maxOpenPositions + 1))
    : cfg.maxOpenPositions;
  if (openN >= softCap) {
    return {
      ok: false,
      skipped: true,
      reason: `Déjà ${openN} positions ≥ cap ${softCap}`,
    };
  }

  // Refuse double entrée sur le même coin
  const already = portfolio.positions.find(
    (p) => p.coin.toUpperCase() === req.coin.toUpperCase(),
  );
  if (already) {
    return {
      ok: false,
      reason: `Position HL déjà ouverte ${already.coin} ${already.side}`,
    };
  }

  // LIVE size = même % de marge que le paper sur l’equity HL (ou 2% risque)
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
    paperMarginEur: req.paperMarginEur,
    paperBankrollEur: req.paperBankrollEur,
    mirrorPaper: mirror,
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
      ? aggressivePx(req.side, mid, req.entry, asset.szDecimals)
      : formatPx(req.entry, asset.szDecimals);
  const tpPx = formatPx(req.tp, asset.szDecimals);
  const slPx = formatPx(req.sl, asset.szDecimals);

  const client = getExchangeClient(cfg.testnet);

  try {
    await client.updateLeverage({
      asset: asset.id,
      isCross: true,
      leverage: Math.min(liveLev, asset.maxLeverage),
    });
  } catch (e) {
    return {
      ok: false,
      skipped: /429|Too Many|timeout/i.test(hlErrMessage(e)),
      reason: `Levier HL: ${hlErrMessage(e)}`,
    };
  }

  const sizeNum = Number(size);
  const useSmcSplit =
    req.strategy === "smc" &&
    req.tp1 != null &&
    Number(req.tp1) > 0 &&
    Math.abs(Number(req.tp1) - req.tp) > 1e-12;

  const halfSz = formatSz(sizeNum / 2, asset.szDecimals);
  const tp1Px = useSmcSplit
    ? formatPx(Number(req.tp1), asset.szDecimals)
    : tpPx;
  const tp2Px = useSmcSplit
    ? formatPx(req.tp2 ?? req.tp, asset.szDecimals)
    : tpPx;

  let result: Awaited<ReturnType<typeof client.order>>;
  let entryOid: number | null = null;
  let tpOid: number | null = null;
  let slOid: number | null = null;

  try {
    if (useSmcSplit && halfSz && Number(halfSz) > 0) {
      // Comme paper : entrée pleine, TP1 50%, TP2 50%, SL 100%.
      const entryRes = await client.order({
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
        ],
        grouping: "na",
      });
      const entryStatuses = entryRes.response?.data?.statuses ?? [];
      const entryErr = entryStatuses.find(
        (s) => s && typeof s === "object" && "error" in s,
      ) as { error?: string } | undefined;
      if (entryErr?.error) {
        return {
          ok: false,
          reason: entryErr.error,
          coin: asset.name,
          assetId: asset.id,
          size,
          raw: entryRes,
        };
      }
      entryOid = readOid(entryStatuses[0]);

      result = await client.order({
        orders: [
          {
            a: asset.id,
            b: !isBuy,
            p: tp1Px,
            s: halfSz,
            r: true,
            t: {
              trigger: {
                isMarket: true,
                triggerPx: tp1Px,
                tpsl: "tp",
              },
            },
          },
          {
            a: asset.id,
            b: !isBuy,
            p: tp2Px,
            s: halfSz,
            r: true,
            t: {
              trigger: {
                isMarket: true,
                triggerPx: tp2Px,
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
        grouping: "na",
      });
      let statuses = result.response?.data?.statuses ?? [];
      let err = statuses.find(
        (s) => s && typeof s === "object" && "error" in s,
      ) as { error?: string } | undefined;
      // Retry 1× si le batch protecteur échoue (évite position nue)
      if (err?.error) {
        await new Promise((r) => setTimeout(r, 800));
        try {
          result = await client.order({
            orders: [
              {
                a: asset.id,
                b: !isBuy,
                p: tp1Px,
                s: halfSz,
                r: true,
                t: {
                  trigger: {
                    isMarket: true,
                    triggerPx: tp1Px,
                    tpsl: "tp",
                  },
                },
              },
              {
                a: asset.id,
                b: !isBuy,
                p: tp2Px,
                s: halfSz,
                r: true,
                t: {
                  trigger: {
                    isMarket: true,
                    triggerPx: tp2Px,
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
            grouping: "na",
          });
          statuses = result.response?.data?.statuses ?? [];
          err = statuses.find(
            (s) => s && typeof s === "object" && "error" in s,
          ) as { error?: string } | undefined;
        } catch (retryErr) {
          err = { error: hlErrMessage(retryErr) };
        }
      }
      if (err?.error) {
        // Dernier recours : flatten pour ne pas laisser une position sans TP/SL
        try {
          const midInfo = new InfoClient({
            transport: makeTransport(cfg.testnet),
          });
          const mids = await midInfo.allMids();
          const mid = Number(
            mids[asset.name] ?? mids[asset.name.toUpperCase()] ?? req.entry,
          );
          const flatPx = aggressivePx(
            req.side === "long" ? "short" : "long",
            mid > 0 ? mid : req.entry,
            req.entry,
            asset.szDecimals,
          );
          await client.order({
            orders: [
              {
                a: asset.id,
                b: !isBuy,
                p: flatPx,
                s: size,
                r: true,
                t: { limit: { tif: "FrontendMarket" } },
              },
            ],
            grouping: "na",
          });
        } catch (flatErr) {
          console.error("SMC live flatten after naked TP/SL fail", flatErr);
        }
        return {
          ok: false,
          reason: `TP/SL refusés après entrée (${err.error}) — tentative de flatten`,
          coin: asset.name,
          assetId: asset.id,
          size,
          entryOid,
          raw: result,
        };
      }
      tpOid = readOid(statuses[1]);
      slOid = readOid(statuses[2]);
    } else {
      result = await client.order({
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
      entryOid = readOid(statuses[0]);
      tpOid = readOid(statuses[1]);
      slOid = readOid(statuses[2]);
    }
  } catch (e) {
    const msg = hlErrMessage(e);
    const soft = /429|Too Many|timeout|timed out/i.test(msg);
    return {
      ok: false,
      skipped: soft,
      reason: msg,
      coin: asset.name,
      assetId: asset.id,
      size,
    };
  }

  // Labels / Si TP-SL toujours calculés (même si journal échoue)
  const { botLabelFromPortfolio, tradeOutcomesUsd } = await import(
    "./trade-outcomes"
  );
  const botLabel = botLabelFromPortfolio({
    portfolioId: req.portfolioId,
    portfolioName: req.portfolioName,
    strategy: req.strategy,
  });
  // Si TP affiché = TP2 (sortie pleine) comme paper vise le TP final
  const outcomes = tradeOutcomesUsd({
    side: req.side,
    entry: req.entry,
    tp: req.tp,
    sl: req.sl,
    size: sizeNum,
  });
  const tpPnlUsd = outcomes.tpPnlUsd;
  const slPnlUsd = outcomes.slPnlUsd;

  // 1) Journal d’abord (pour que repair voie l’entrée)
  let journalOk = false;
  try {
    const { recordLiveJournalEntry } = await import("./live-journal");
    await recordLiveJournalEntry({
      coin: asset.name,
      side: req.side,
      entry: req.entry,
      tp: req.tp,
      sl: req.sl,
      tp1: useSmcSplit ? Number(req.tp1) : null,
      tp2: useSmcSplit ? Number(req.tp2 ?? req.tp) : null,
      tp1Hit: false,
      size: sizeNum,
      leverage: liveLev,
      riskPct: req.riskPct ?? 2,
      riskUsd: sized.riskUsd,
      portfolioId: req.portfolioId || "boriaz",
      portfolioName: req.portfolioName || botLabel,
      strategy: req.strategy === "smc" ? "smc" : "alignment",
      botLabel: "Boriaz",
      paperId: req.paperId,
      entryOid,
      tpOid,
      slOid,
    });
    journalOk = true;
  } catch (e) {
    console.error("live journal record failed", e);
  }

  // 2) Confirmer TP/SL sur le carnet ; repair si besoin
  let protectedOk = Boolean(tpOid && slOid);
  try {
    await new Promise((r) => setTimeout(r, 350));
    const tpslMap = await fetchLiveExchangeTpslMap();
    const ex = tpslMap[asset.name.toUpperCase()];
    if (ex?.tp != null && ex?.sl != null) {
      protectedOk = true;
      if (!tpOid && ex.tpOid) tpOid = ex.tpOid;
      if (!slOid && ex.slOid) slOid = ex.slOid;
    } else {
      const repair = await repairNakedLiveTpsl();
      void repair;
      await new Promise((r) => setTimeout(r, 400));
      const again = await fetchLiveExchangeTpslMap();
      const ex2 = again[asset.name.toUpperCase()];
      if (ex2?.tp != null && ex2?.sl != null) {
        protectedOk = true;
        if (ex2.tpOid) tpOid = ex2.tpOid;
        if (ex2.slOid) slOid = ex2.slOid;
      }
    }
  } catch (e) {
    console.info("post-place TP/SL confirm", e);
  }

  if (!journalOk) {
    return {
      ok: false,
      reason:
        "Ordre placé mais journal LIVE échoué — position à surveiller manuellement",
      coin: asset.name,
      assetId: asset.id,
      size,
      entryOid,
      tpOid,
      slOid,
      riskUsd: sized.riskUsd,
      tpPnlUsd,
      slPnlUsd,
      botLabel: "Boriaz",
      raw: result,
    };
  }

  if (!protectedOk) {
    return {
      ok: false,
      reason:
        "Entrée journalée mais TP/SL non confirmés sur HL — repair cron suivra",
      coin: asset.name,
      assetId: asset.id,
      size,
      entryOid,
      tpOid,
      slOid,
      riskUsd: sized.riskUsd,
      tpPnlUsd,
      slPnlUsd,
      botLabel: "Boriaz",
      raw: result,
    };
  }

  return {
    ok: true,
    coin: asset.name,
    assetId: asset.id,
    size,
    entryOid,
    tpOid,
    slOid,
    riskUsd: sized.riskUsd,
    tpPnlUsd,
    slPnlUsd,
    botLabel: "Boriaz",
    reason: sized.note,
    raw: result,
  };
}

/** Retry soft : un paper Boriaz doit tenter le live même si equity/API lag. */


/**
 * Miroir paper SMC sur le live :
 * TP1 touché → (si besoin) réduire 50% + SL → BE + TP2 sur le reste.
 * Appelé par le cron / getTradeSignals — ne change pas le paper.
 */
export async function manageLiveSmcPositions(): Promise<{
  checked: number;
  updated: number;
  notes: string[];
}> {
  const ready = isLiveEnvReady();
  if (!ready.ok) return { checked: 0, updated: 0, notes: [ready.reason || "env"] };

  const { loadLiveJournal, updateLiveJournalEntry } = await import("./live-journal");
  const journal = (await loadLiveJournal()).filter(
    (e) =>
      e.status === "open" &&
      e.strategy === "smc" &&
      e.tp1 != null &&
      Number(e.tp1) > 0 &&
      !e.tp1Hit,
  );

  const cfg = getLiveConfig();
  const notes: string[] = [];
  let updated = 0;
  let checked = 0;

  if (!journal.length) {
    const repaired = await repairNakedLiveTpsl();
    return {
      checked: repaired.checked,
      updated: repaired.updated,
      notes: repaired.notes,
    };
  }

  const portfolio = await fetchLivePortfolio();
  if (!portfolio.ok) {
    const repaired = await repairNakedLiveTpsl();
    return {
      checked: journal.length + repaired.checked,
      updated: repaired.updated,
      notes: [portfolio.reason || "portfolio", ...repaired.notes],
    };
  }
  const info = new InfoClient({ transport: makeTransport(cfg.testnet) });
  const mids = await info.allMids();
  const assets = await loadAssetMap(cfg.testnet);
  const client = getExchangeClient(cfg.testnet);
  checked = journal.length;

  for (const entry of journal) {
    const pos = portfolio.positions.find(
      (p) =>
        p.coin.toUpperCase() === entry.coin.toUpperCase() &&
        p.side === entry.side,
    );
    if (!pos) continue;
    const mid = Number(mids[entry.coin] ?? mids[entry.coin.toUpperCase()] ?? 0);
    const px = mid > 0 ? mid : pos.entryPx;
    const tp1 = Number(entry.tp1);
    const hitTp1 =
      entry.side === "long" ? px >= tp1 : px <= tp1;
    // Position déjà ~50% (TP1 ordre auto rempli) ou prix a touché TP1
    const sizeNow = Math.abs(pos.size);
    const halfish = sizeNow <= entry.size * 0.65;
    if (!hitTp1 && !halfish) continue;

    const asset = assets.get(entry.coin.toUpperCase());
    if (!asset) continue;

    try {
      // Annuler UNIQUEMENT les TP/SL trigger (pas d’autres ordres limit)
      try {
        const opens = await info.frontendOpenOrders({
          user: cfg.accountAddress as `0x${string}`,
        });
        const cancels = (opens ?? [])
          .filter(
            (o) =>
              String(o.coin || "").toUpperCase() ===
                entry.coin.toUpperCase() && isProtectiveOpenOrder(o),
          )
          .map((o) => ({ a: asset.id, o: Number(o.oid) }))
          .filter((c) => Number.isFinite(c.o));
        if (cancels.length) {
          await client.cancel({ cancels });
        }
      } catch (e) {
        console.info("manageLiveSmc cancel", e);
      }

      // Si encore pleine taille : clôturer 50% market (comme paper TP1)
      let remaining = sizeNow;
      if (!halfish && sizeNow > 0) {
        const closeSz = formatSz(sizeNow / 2, asset.szDecimals);
        if (closeSz && Number(closeSz) > 0) {
          const isBuy = entry.side === "short"; // close long = sell
          const closePx = aggressivePx(
            entry.side === "long" ? "short" : "long",
            px,
            px,
            asset.szDecimals,
          );
          await client.order({
            orders: [
              {
                a: asset.id,
                b: isBuy,
                p: closePx,
                s: closeSz,
                r: true,
                t: { limit: { tif: "FrontendMarket" } },
              },
            ],
            grouping: "na",
          });
          remaining = sizeNow / 2;
        }
      }

      const remSz = formatSz(remaining, asset.szDecimals);
      if (!remSz || Number(remSz) <= 0) {
        await updateLiveJournalEntry(entry.id, {
          tp1Hit: true,
          sl: entry.entry,
        });
        updated += 1;
        notes.push(`${entry.coin}: TP1/BE (size flat)`);
        continue;
      }

      const bePx = formatPx(entry.entry, asset.szDecimals);
      const tp2Px = formatPx(Number(entry.tp2 ?? entry.tp), asset.szDecimals);
      const isBuy = entry.side === "long";
      const placeBeTp2 = async () =>
        client.order({
          orders: [
            {
              a: asset.id,
              b: !isBuy,
              p: tp2Px,
              s: remSz,
              r: true,
              t: {
                trigger: {
                  isMarket: true,
                  triggerPx: tp2Px,
                  tpsl: "tp",
                },
              },
            },
            {
              a: asset.id,
              b: !isBuy,
              p: bePx,
              s: remSz,
              r: true,
              t: {
                trigger: {
                  isMarket: true,
                  triggerPx: bePx,
                  tpsl: "sl",
                },
              },
            },
          ],
          grouping: "na",
        });
      let tpsl = await placeBeTp2();
      let st = tpsl.response?.data?.statuses ?? [];
      let tpslErr = st.find(
        (s) => s && typeof s === "object" && "error" in s,
      ) as { error?: string } | undefined;
      if (tpslErr?.error) {
        await new Promise((r) => setTimeout(r, 700));
        tpsl = await placeBeTp2();
        st = tpsl.response?.data?.statuses ?? [];
        tpslErr = st.find(
          (s) => s && typeof s === "object" && "error" in s,
        ) as { error?: string } | undefined;
      }
      if (tpslErr?.error) {
        notes.push(
          `${entry.coin}: TP2/BE refusés après cancel (${tpslErr.error}) — position peut être nue`,
        );
        continue;
      }
      const tp2 = Number(entry.tp2 ?? entry.tp);
      const { tradeOutcomesUsd } = await import("./trade-outcomes");
      const outcomes = tradeOutcomesUsd({
        side: entry.side,
        entry: entry.entry,
        tp: tp2,
        sl: entry.entry,
        size: remaining,
      });
      await updateLiveJournalEntry(entry.id, {
        tp1Hit: true,
        sl: entry.entry,
        size: remaining,
        tp: tp2,
        tpPnlUsd: outcomes.tpPnlUsd,
        slPnlUsd: outcomes.slPnlUsd,
        tpOid: readOid(st[0]),
        slOid: readOid(st[1]),
      });
      updated += 1;
      notes.push(`${entry.coin}: TP1 50% + SL→BE · vise TP2`);
    } catch (e) {
      notes.push(
        `${entry.coin}: manage err ${e instanceof Error ? e.message : "x"}`,
      );
    }
  }

  const repaired = await repairNakedLiveTpsl();
  notes.push(...repaired.notes);
  updated += repaired.updated;

  return { checked: checked + repaired.checked, updated, notes };
}

/**
 * Si une position Boriaz (journal) n’a plus de TP/SL sur HL → re-place.
 * Évite les positions « nues » après échec cancel/replace.
 */
export async function repairNakedLiveTpsl(): Promise<{
  checked: number;
  updated: number;
  notes: string[];
}> {
  const ready = isLiveEnvReady();
  if (!ready.ok) return { checked: 0, updated: 0, notes: [] };
  const cfg = getLiveConfig();
  const { loadLiveJournal, updateLiveJournalEntry } = await import(
    "./live-journal"
  );
  const journal = (await loadLiveJournal()).filter((e) => e.status === "open");
  if (!journal.length) return { checked: 0, updated: 0, notes: [] };

  const portfolio = await fetchLivePortfolio();
  if (!portfolio.ok) return { checked: 0, updated: 0, notes: [] };

  const info = new InfoClient({ transport: makeTransport(cfg.testnet) });
  const opens = await info.frontendOpenOrders({
    user: cfg.accountAddress as `0x${string}`,
  }).catch(() => []);
  const assets = await loadAssetMap(cfg.testnet);
  const client = getExchangeClient(cfg.testnet);
  const notes: string[] = [];
  let updated = 0;
  let checked = 0;

  for (const entry of journal) {
    const pos = portfolio.positions.find(
      (p) =>
        p.coin.toUpperCase() === entry.coin.toUpperCase() &&
        p.side === entry.side,
    );
    if (!pos) continue;
    checked += 1;
    const tpsl = extractTpslFromOpenOrders(opens ?? [], entry.coin);
    if (tpsl.tp != null && tpsl.sl != null) continue;
    if (!(entry.tp > 0 && entry.sl > 0)) continue;

    const asset = assets.get(entry.coin.toUpperCase());
    if (!asset) continue;
    const size = formatSz(Math.abs(pos.size), asset.szDecimals);
    if (!size || Number(size) <= 0) continue;

    const isBuy = entry.side === "long";
    const tpPx = formatPx(entry.tp, asset.szDecimals);
    const slPx = formatPx(entry.sl, asset.szDecimals);
    try {
      const res = await client.order({
        orders: [
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
        grouping: "na",
      });
      const st = res.response?.data?.statuses ?? [];
      const err = st.find(
        (s) => s && typeof s === "object" && "error" in s,
      ) as { error?: string } | undefined;
      if (err?.error) {
        notes.push(`${entry.coin}: repair TP/SL refusé (${err.error})`);
        continue;
      }
      await updateLiveJournalEntry(entry.id, {
        tpOid: readOid(st[0]),
        slOid: readOid(st[1]),
      });
      updated += 1;
      notes.push(`${entry.coin}: TP/SL réparés sur HL`);
    } catch (e) {
      notes.push(
        `${entry.coin}: repair err ${e instanceof Error ? e.message : "x"}`,
      );
    }
  }

  return { checked, updated, notes };
}

export async function placeBoriazLiveTradeMirrored(
  req: LiveTradeRequest,
): Promise<LiveTradeResult> {
  const payload: LiveTradeRequest = { ...req, mirrorPaper: true };
  let last: LiveTradeResult = {
    ok: false,
    skipped: true,
    reason: "LIVE miroir non tenté",
  };
  for (let attempt = 1; attempt <= 3; attempt++) {
    last = await placeBoriazLiveTrade(payload);
    if (last.ok) return last;
    // Échec HL dur (ordre rejeté) → stop ; skip soft → retry
    if (!last.skipped) return last;
    console.info(
      `LIVE Boriaz mirror attempt ${attempt}/3 skipped:`,
      last.reason,
    );
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  return last;
}

/**
 * Clôture manuelle d’une position LIVE (market reduce-only).
 * Annule d’abord les TP/SL ouverts sur le coin, puis flatten.
 */
export async function closeLivePosition(opts: {
  coin: string;
  side?: LiveSide;
  /** 1 = tout, 0.5 = moitié, etc. */
  fraction?: number;
}): Promise<{
  ok: boolean;
  reason?: string;
  coin?: string;
  side?: LiveSide;
  sizeClosed?: string;
  pnlUsd?: number;
  raw?: unknown;
}> {
  const ready = isLiveEnvReady();
  if (!ready.ok) {
    return { ok: false, reason: ready.reason || "LIVE HL non prêt" };
  }
  const coin = String(opts.coin || "").trim().toUpperCase();
  if (!coin) return { ok: false, reason: "coin requis" };

  const fraction =
    opts.fraction == null
      ? 1
      : Math.min(1, Math.max(0.01, Number(opts.fraction) || 1));

  const cfg = getLiveConfig();
  const portfolio = await fetchLivePortfolio();
  if (!portfolio.ok) {
    return { ok: false, reason: portfolio.reason || "Portfolio illisible" };
  }

  const pos = portfolio.positions.find(
    (p) =>
      p.coin.toUpperCase() === coin &&
      (opts.side == null || p.side === opts.side),
  );
  if (!pos) {
    return {
      ok: false,
      reason: opts.side
        ? `Pas de position ${opts.side} ${coin} ouverte`
        : `Pas de position ${coin} ouverte`,
    };
  }

  const assets = await loadAssetMap(cfg.testnet);
  const asset = assets.get(coin);
  if (!asset) return { ok: false, reason: `Asset ${coin} inconnu sur HL` };

  const info = new InfoClient({ transport: makeTransport(cfg.testnet) });
  const client = getExchangeClient(cfg.testnet);
  const mids = await info.allMids();
  const mid = Number(mids[coin] ?? mids[pos.coin] ?? 0);
  const px = mid > 0 ? mid : pos.entryPx;

  try {
    // Annuler TP/SL restants sur ce coin
    try {
      const opens = await info.frontendOpenOrders({
        user: cfg.accountAddress as `0x${string}`,
      });
      const cancels = (opens ?? [])
        .filter((o) => String(o.coin || "").toUpperCase() === coin)
        .map((o) => ({ a: asset.id, o: Number(o.oid) }))
        .filter((c) => Number.isFinite(c.o));
      if (cancels.length) {
        await client.cancel({ cancels });
      }
    } catch (e) {
      console.info("closeLivePosition cancel", e);
    }

    const sizeAbs = Math.abs(pos.size) * fraction;
    const closeSz = formatSz(sizeAbs, asset.szDecimals);
    if (!closeSz || Number(closeSz) <= 0) {
      return { ok: false, reason: "Taille à clôturer nulle" };
    }

    // Close long = sell ; close short = buy
    const isBuy = pos.side === "short";
    const closePx = aggressivePx(
      pos.side === "long" ? "short" : "long",
      px,
      pos.entryPx,
      asset.szDecimals,
    );

    const result = await client.order({
      orders: [
        {
          a: asset.id,
          b: isBuy,
          p: closePx,
          s: closeSz,
          r: true,
          t: { limit: { tif: "FrontendMarket" } },
        },
      ],
      grouping: "na",
    });

    // Journal : fermer si flatten complet
    try {
      const {
        loadLiveJournal,
        matchJournalToPosition,
        updateLiveJournalEntry,
        syncLiveJournalWithPositions,
      } = await import("./live-journal");
      if (fraction >= 0.99) {
        const open = (await loadLiveJournal()).filter((e) => e.status === "open");
        const j = matchJournalToPosition(open, pos.coin, pos.side);
        if (j) {
          await updateLiveJournalEntry(j.id, {
            status: "closed",
            closedAt: Date.now(),
          });
        }
        // Resync au cas où d’autres entrées orphelines
        const after = await fetchLivePortfolio();
        if (after.ok) {
          await syncLiveJournalWithPositions(
            after.positions.map((p) => ({ coin: p.coin, side: p.side })),
          );
        }
      }
    } catch (e) {
      console.info("closeLivePosition journal", e);
    }

    return {
      ok: true,
      coin: pos.coin,
      side: pos.side,
      sizeClosed: closeSz,
      pnlUsd: pos.unrealizedPnlUsd * fraction,
      raw: result,
    };
  } catch (e) {
    return { ok: false, reason: hlErrMessage(e) };
  }
}


