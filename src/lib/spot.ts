import { parseNum } from "./format";
import type {
  Fill,
  HedgeAlert,
  OpenPosition,
  SpotBuyEvent,
  SpotHolding,
} from "./types";

/** Map unit tokens / aliases vers un actif de base comparable aux perps. */
const BASE_ALIASES: Record<string, string> = {
  BTC: "BTC",
  UBTC: "BTC",
  ETH: "ETH",
  UETH: "ETH",
  SOL: "SOL",
  USOL: "SOL",
  HYPE: "HYPE",
  UHYPE: "HYPE",
  XRP: "XRP",
  UXRP: "XRP",
  DOGE: "DOGE",
  UDOGE: "DOGE",
  SUI: "SUI",
  USUI: "SUI",
  AVAX: "AVAX",
  UAVAX: "AVAX",
  BNB: "BNB",
  UBNB: "BNB",
  LINK: "LINK",
  ULINK: "LINK",
  APT: "APT",
  UAPT: "APT",
  ARB: "ARB",
  UARB: "ARB",
  OP: "OP",
  UOP: "OP",
  TIA: "TIA",
  UTIA: "TIA",
  SEI: "SEI",
  USEI: "SEI",
  PEPE: "PEPE",
  UPEPE: "PEPE",
  WIF: "WIF",
  UWIF: "WIF",
  ZEC: "ZEC",
  UZEC: "ZEC",
  LTC: "LTC",
  ULTC: "LTC",
  ATOM: "ATOM",
  UATOM: "ATOM",
  NEAR: "NEAR",
  UNEAR: "NEAR",
};

export function baseAssetFromCoin(coin: string): string {
  const raw = coin.includes(":") ? coin.slice(coin.indexOf(":") + 1) : coin;
  const symbol = raw.includes("/") ? raw.split("/")[0]! : raw.replace(/^@/, "");
  const upper = symbol.toUpperCase();
  return BASE_ALIASES[upper] ?? upper;
}

export function isSpotFill(fill: Fill): boolean {
  const dir = fill.dir ?? "";
  if (dir === "Buy" || dir === "Sell") return true;
  if (fill.coin.startsWith("@")) return true;
  if (fill.coin.includes("/")) return true;
  return false;
}

export interface SpotBalanceRaw {
  coin: string;
  token: number;
  total: string;
  hold: string;
  entryNtl: string;
}

export function buildSpotHoldings(
  balances: SpotBalanceRaw[],
  spotMarks: Map<string, number>,
  fills: Fill[],
): SpotHolding[] {
  const buys = extractSpotEvents(fills);
  const out: SpotHolding[] = [];

  for (const bal of balances) {
    const qty = parseNum(bal.total);
    if (qty <= 0) continue;
    if (bal.coin === "USDC") continue;

    const baseAsset = baseAssetFromCoin(bal.coin);
    const entryNtl = parseNum(bal.entryNtl);
    const avgEntryPx = qty > 0 && entryNtl > 0 ? entryNtl / qty : null;
    const markPx =
      spotMarks.get(bal.coin) ??
      spotMarks.get(`${bal.coin}/USDC`) ??
      spotMarks.get(baseAsset) ??
      null;
    const valueUsd = markPx !== null ? qty * markPx : entryNtl;
    const unrealizedPnl =
      markPx !== null && avgEntryPx !== null ? (markPx - avgEntryPx) * qty : null;
    const moveFromEntryPct =
      markPx !== null && avgEntryPx && avgEntryPx > 0
        ? ((markPx - avgEntryPx) / avgEntryPx) * 100
        : null;

    const related = buys.filter((event) => event.baseAsset === baseAsset);
    const buyEvents = related.filter((event) => event.dir === "Buy");
    const sellEvents = related.filter((event) => event.dir === "Sell");
    const lastBuy = buyEvents[0] ?? null;

    out.push({
      coin: bal.coin,
      baseAsset,
      qty,
      hold: parseNum(bal.hold),
      entryNtl,
      avgEntryPx,
      markPx,
      valueUsd,
      unrealizedPnl,
      moveFromEntryPct,
      alreadyAccumulating: buyEvents.length >= 2,
      lastBuyPx: lastBuy?.px ?? null,
      lastBuyAt: lastBuy?.time ?? null,
      lastBuyQty: lastBuy?.qty ?? null,
      buyCount: buyEvents.length,
      sellCount: sellEvents.length,
    });
  }

  return out.sort((a, b) => b.valueUsd - a.valueUsd);
}

export function extractSpotEvents(fills: Fill[]): SpotBuyEvent[] {
  return fills
    .filter(isSpotFill)
    .map((fill) => {
      const dir = (fill.dir === "Sell" ? "Sell" : "Buy") as "Buy" | "Sell";
      const px = parseNum(fill.px);
      const qty = parseNum(fill.sz);
      return {
        coin: fill.coin,
        baseAsset: baseAssetFromCoin(fill.coin),
        px,
        qty,
        notional: px * qty,
        time: fill.time,
        dir,
      };
    })
    .sort((a, b) => b.time - a.time);
}

export function detectHedgeAlerts(
  whale: { address: string; alias: string },
  positions: OpenPosition[],
  spot: SpotHolding[],
): HedgeAlert[] {
  const alerts: HedgeAlert[] = [];
  const spotByBase = new Map<string, SpotHolding>();
  for (const holding of spot) {
    const prev = spotByBase.get(holding.baseAsset);
    if (!prev || holding.valueUsd > prev.valueUsd) {
      spotByBase.set(holding.baseAsset, holding);
    }
  }

  for (const position of positions) {
    const holding = spotByBase.get(position.baseAsset);
    if (!holding || holding.qty <= 0) continue;

    if (position.side === "short") {
      alerts.push({
        id: `${whale.address}:${position.baseAsset}:short_spot`,
        severity: "critical",
        kind: "short_with_spot",
        title: `${whale.alias} short ${position.baseAsset} tout en détenant du spot`,
        detail: `Short perps ${position.qty} ${position.coin} @ ${position.entryPx} alors que le spot ${holding.coin} vaut ~${holding.valueUsd.toFixed(0)}$ (qty ${holding.qty}, entrée moy. ${holding.avgEntryPx ?? "n/d"}). Possible hedge / basis trade — pas forcément un signal directionnel.`,
        baseAsset: position.baseAsset,
        whaleAddress: whale.address,
        whaleAlias: whale.alias,
        spotQty: holding.qty,
        spotAvgPx: holding.avgEntryPx,
        spotValueUsd: holding.valueUsd,
        perpSide: "short",
        perpQty: position.qty,
        perpEntryPx: position.entryPx,
        perpNotionalUsd: position.notionalUsd,
      });
    } else {
      alerts.push({
        id: `${whale.address}:${position.baseAsset}:long_spot`,
        severity: "info",
        kind: "long_with_spot",
        title: `${whale.alias} long ${position.baseAsset} + spot`,
        detail: `Exposition empilée : long perps + spot ${holding.coin} (valeur ~${holding.valueUsd.toFixed(0)}$).`,
        baseAsset: position.baseAsset,
        whaleAddress: whale.address,
        whaleAlias: whale.alias,
        spotQty: holding.qty,
        spotAvgPx: holding.avgEntryPx,
        spotValueUsd: holding.valueUsd,
        perpSide: "long",
        perpQty: position.qty,
        perpEntryPx: position.entryPx,
        perpNotionalUsd: position.notionalUsd,
      });
    }
  }

  for (const holding of spot) {
    if (!holding.alreadyAccumulating) continue;
    const hasPerp = positions.some((p) => p.baseAsset === holding.baseAsset);
    if (hasPerp) continue;
    alerts.push({
      id: `${whale.address}:${holding.baseAsset}:accum`,
      severity: "warn",
      kind: "spot_only_accumulation",
      title: `${whale.alias} accumule du spot ${holding.baseAsset}`,
      detail: `${holding.buyCount} achats spot détectés dans l’historique fills. Dernier achat ${holding.lastBuyPx ?? "n/d"} · entrée moy. portefeuille ${holding.avgEntryPx ?? "n/d"}.`,
      baseAsset: holding.baseAsset,
      whaleAddress: whale.address,
      whaleAlias: whale.alias,
      spotQty: holding.qty,
      spotAvgPx: holding.avgEntryPx,
      spotValueUsd: holding.valueUsd,
      perpSide: null,
      perpQty: null,
      perpEntryPx: null,
      perpNotionalUsd: null,
    });
  }

  return alerts;
}

export function buildSpotMarkMap(
  ctxs: { coin?: string; markPx?: string }[],
  perpMarks: Map<string, number>,
): Map<string, number> {
  const map = new Map<string, number>(perpMarks);
  for (const ctx of ctxs) {
    if (!ctx.coin) continue;
    const px = parseNum(ctx.markPx);
    if (px > 0) {
      map.set(ctx.coin, px);
      const base = baseAssetFromCoin(ctx.coin);
      if (!map.has(base)) map.set(base, px);
    }
  }
  return map;
}
