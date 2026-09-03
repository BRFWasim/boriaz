import { parseNum } from "./format";
import type {
  AssetCtx,
  ClosedPosition,
  CoinCrowd,
  ExposureStats,
  Fill,
  MarketOverview,
  OpenPosition,
  TradeStats,
  UniverseAsset,
  Whale,
  WindowStats,
} from "./types";

export function buildMarketMaps(
  universe: UniverseAsset[],
  ctxs: AssetCtx[],
): {
  marks: Map<string, number>;
  funding: Map<string, number>;
  openInterest: Map<string, number>;
  dayVolume: Map<string, number>;
} {
  const marks = new Map<string, number>();
  const funding = new Map<string, number>();
  const openInterest = new Map<string, number>();
  const dayVolume = new Map<string, number>();
  const n = Math.min(universe.length, ctxs.length);
  for (let i = 0; i < n; i++) {
    const name = universe[i]?.name;
    if (!name) continue;
    const ctx = ctxs[i];
    const mark = parseNum(ctx?.markPx);
    if (mark > 0) marks.set(name, mark);
    if (ctx?.funding !== undefined) funding.set(name, parseNum(ctx.funding));
    if (ctx?.openInterest !== undefined) {
      openInterest.set(name, parseNum(ctx.openInterest) * (mark || 1));
    }
    if (ctx?.dayNtlVlm !== undefined) dayVolume.set(name, parseNum(ctx.dayNtlVlm));
  }
  return { marks, funding, openInterest, dayVolume };
}

export function distanceToLiquidationPct(
  side: "long" | "short",
  markPx: number | null,
  liquidationPx: number | null,
): number | null {
  if (!markPx || markPx <= 0 || liquidationPx === null || liquidationPx <= 0) {
    return null;
  }
  if (side === "long") return ((markPx - liquidationPx) / markPx) * 100;
  return ((liquidationPx - markPx) / markPx) * 100;
}

export function moveFromEntryPct(
  side: "long" | "short",
  entryPx: number,
  markPx: number | null,
): number | null {
  if (!markPx || markPx <= 0 || entryPx <= 0) return null;
  const raw = ((markPx - entryPx) / entryPx) * 100;
  return side === "long" ? raw : -raw;
}

export function computeTradeStats(fills: Fill[]): TradeStats {
  const closes = fills.filter((fill) => {
    if (fill.coin.startsWith("@")) return false;
    const dir = fill.dir ?? "";
    if (dir === "Buy" || dir === "Sell") return false;
    if (!(dir.startsWith("Close") || dir.includes(">"))) return false;
    return true;
  });

  const withPnl = closes.filter((fill) => parseNum(fill.closedPnl) !== 0);
  const wins = withPnl.filter((fill) => parseNum(fill.closedPnl) > 0);
  const losses = withPnl.filter((fill) => parseNum(fill.closedPnl) < 0);
  const sumWins = wins.reduce((acc, fill) => acc + parseNum(fill.closedPnl), 0);
  const sumLosses = losses.reduce(
    (acc, fill) => acc + Math.abs(parseNum(fill.closedPnl)),
    0,
  );
  const totalRealized = withPnl.reduce(
    (acc, fill) => acc + parseNum(fill.closedPnl),
    0,
  );
  const feesPaid = fills.reduce((acc, fill) => {
    const fee = parseNum(fill.fee);
    return fee > 0 ? acc + fee : acc;
  }, 0);

  const sample = withPnl.length;
  const avgWin = wins.length ? sumWins / wins.length : 0;
  const avgLoss = losses.length ? sumLosses / losses.length : 0;
  const expectancy = sample ? totalRealized / sample : null;

  return {
    winRate: sample ? wins.length / sample : null,
    sample,
    avgWin,
    avgLoss,
    profitFactor:
      sumLosses > 0 ? sumWins / sumLosses : sumWins > 0 ? Number.POSITIVE_INFINITY : null,
    expectancy,
    totalRealizedSample: totalRealized,
    feesPaid,
  };
}

export function computeExposure(positions: OpenPosition[], state: {
  marginUsed: number;
  equity: number;
  withdrawable: number;
}): ExposureStats {
  let longUsd = 0;
  let shortUsd = 0;
  let unrealizedTotal = 0;
  let fundingOpenTotal = 0;
  let protectedWithSl = 0;
  let protectedWithTp = 0;
  let nearLiquidationCount = 0;
  let leverageWeighted = 0;
  let maxLeverageUsed = 0;
  const byCoin = new Map<string, number>();

  for (const position of positions) {
    if (position.side === "long") longUsd += position.notionalUsd;
    else shortUsd += position.notionalUsd;
    unrealizedTotal += position.unrealizedPnl;
    fundingOpenTotal += position.fundingSinceOpen;
    if (position.sl) protectedWithSl += 1;
    if (position.tp) protectedWithTp += 1;
    if (
      position.distanceToLiqPct !== null &&
      position.distanceToLiqPct >= 0 &&
      position.distanceToLiqPct < 8
    ) {
      nearLiquidationCount += 1;
    }
    leverageWeighted += position.leverage * position.notionalUsd;
    maxLeverageUsed = Math.max(maxLeverageUsed, position.leverage);
    byCoin.set(
      position.coin,
      (byCoin.get(position.coin) ?? 0) + position.notionalUsd,
    );
  }

  const grossUsd = longUsd + shortUsd;
  const netUsd = longUsd - shortUsd;
  let concentrationTopCoin: string | null = null;
  let concentrationTopPct = 0;
  for (const [coin, usd] of byCoin) {
    const pct = grossUsd > 0 ? (usd / grossUsd) * 100 : 0;
    if (pct > concentrationTopPct) {
      concentrationTopPct = pct;
      concentrationTopCoin = coin;
    }
  }

  return {
    longUsd,
    shortUsd,
    netUsd,
    grossUsd,
    longPct: grossUsd > 0 ? (longUsd / grossUsd) * 100 : 0,
    shortPct: grossUsd > 0 ? (shortUsd / grossUsd) * 100 : 0,
    marginUsed: state.marginUsed,
    marginRatio: state.equity > 0 ? (state.marginUsed / state.equity) * 100 : 0,
    withdrawable: state.withdrawable,
    avgLeverage: grossUsd > 0 ? leverageWeighted / grossUsd : 0,
    maxLeverageUsed,
    unrealizedTotal,
    fundingOpenTotal,
    protectedWithSl,
    protectedWithTp,
    unprotectedCount: Math.max(0, positions.length - protectedWithSl),
    nearLiquidationCount,
    concentrationTopCoin,
    concentrationTopPct,
  };
}

export function scoreRisk(exposure: ExposureStats, positions: number): {
  score: number;
  label: Whale["riskLabel"];
} {
  let score = 0;
  score += Math.min(35, exposure.avgLeverage * 2.2);
  score += Math.min(20, exposure.marginRatio / 4);
  score += Math.min(15, exposure.nearLiquidationCount * 7);
  score += Math.min(10, exposure.unprotectedCount * 2);
  score += Math.min(10, Math.max(0, exposure.concentrationTopPct - 40) / 4);
  score += Math.min(10, positions > 20 ? 10 : positions / 2);
  score = Math.round(Math.min(100, Math.max(0, score)));

  const label: Whale["riskLabel"] =
    score >= 75 ? "critique" : score >= 55 ? "élevé" : score >= 35 ? "modéré" : "faible";
  return { score, label };
}

export function biasFromNet(netUsd: number, grossUsd: number): Whale["bias"] {
  if (grossUsd <= 0) return "neutre";
  const ratio = netUsd / grossUsd;
  if (ratio > 0.15) return "long";
  if (ratio < -0.15) return "short";
  return "neutre";
}

export function fullWindow(
  row: {
    windowPerformances: [string, { pnl: string; roi: string; vlm: string }][];
  },
  window: string,
): WindowStats {
  const found = row.windowPerformances?.find((item) => item[0] === window)?.[1];
  return {
    pnl: parseNum(found?.pnl),
    roi: parseNum(found?.roi),
    volume: parseNum(found?.vlm),
  };
}

export function buildOverview(whales: Whale[]): MarketOverview {
  let totalEquity = 0;
  let totalLongUsd = 0;
  let totalShortUsd = 0;
  let totalUnrealized = 0;
  let totalPnl24h = 0;
  let winSum = 0;
  let winN = 0;
  const coinMap = new Map<string, CoinCrowd>();

  for (const whale of whales) {
    totalEquity += whale.portfolioUsd;
    totalLongUsd += whale.exposure.longUsd;
    totalShortUsd += whale.exposure.shortUsd;
    totalUnrealized += whale.exposure.unrealizedTotal;
    totalPnl24h += whale.day.pnl;
    if (whale.tradeStats.winRate !== null && whale.tradeStats.sample > 0) {
      winSum += whale.tradeStats.winRate;
      winN += 1;
    }
    for (const position of whale.positions) {
      const cur = coinMap.get(position.coin) ?? {
        coin: position.coin,
        whaleCount: 0,
        longUsd: 0,
        shortUsd: 0,
        netUsd: 0,
        fundingRate8h: position.fundingRate8h,
      };
      if (position.side === "long") cur.longUsd += position.notionalUsd;
      else cur.shortUsd += position.notionalUsd;
      cur.netUsd = cur.longUsd - cur.shortUsd;
      if (position.fundingRate8h !== null) cur.fundingRate8h = position.fundingRate8h;
      coinMap.set(position.coin, cur);
    }
  }

  for (const coin of coinMap.values()) {
    coin.whaleCount = whales.filter((whale) =>
      whale.positions.some((position) => position.coin === coin.coin),
    ).length;
  }

  const crowded = [...coinMap.values()]
    .sort(
      (a, b) =>
        b.longUsd + b.shortUsd - (a.longUsd + a.shortUsd) || b.whaleCount - a.whaleCount,
    )
    .slice(0, 8);

  const riskiest = [...whales]
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 3)
    .map((whale) => ({
      alias: whale.alias,
      address: whale.address,
      riskScore: whale.riskScore,
      riskLabel: whale.riskLabel,
    }));

  const netBiasUsd = totalLongUsd - totalShortUsd;
  const gross = totalLongUsd + totalShortUsd;
  const shortWithSpotCount = whales.filter((whale) =>
    whale.alerts.some((alert) => alert.kind === "short_with_spot"),
  ).length;
  const totalSpotValueUsd = whales.reduce(
    (acc, whale) => acc + (whale.spotValueUsd ?? 0),
    0,
  );

  return {
    whaleCount: whales.length,
    totalEquity,
    totalGrossExposure: gross,
    totalLongUsd,
    totalShortUsd,
    netBiasUsd,
    bias: biasFromNet(netBiasUsd, gross),
    avgWinRate: winN ? winSum / winN : null,
    totalUnrealized,
    totalPnl24h,
    crowded,
    riskiest,
    shortWithSpotCount,
    totalSpotValueUsd,
    crowdShortCount: 0,
    crowdLongCount: 0,
    priorityAlertCount: 0,
  };
}

export function emptyExposure(): ExposureStats {
  return {
    longUsd: 0,
    shortUsd: 0,
    netUsd: 0,
    grossUsd: 0,
    longPct: 0,
    shortPct: 0,
    marginUsed: 0,
    marginRatio: 0,
    withdrawable: 0,
    avgLeverage: 0,
    maxLeverageUsed: 0,
    unrealizedTotal: 0,
    fundingOpenTotal: 0,
    protectedWithSl: 0,
    protectedWithTp: 0,
    unprotectedCount: 0,
    nearLiquidationCount: 0,
    concentrationTopCoin: null,
    concentrationTopPct: 0,
  };
}

export function emptyTradeStats(): TradeStats {
  return {
    winRate: null,
    sample: 0,
    avgWin: 0,
    avgLoss: 0,
    profitFactor: null,
    expectancy: null,
    totalRealizedSample: 0,
    feesPaid: 0,
  };
}

export function emptyWindow(): WindowStats {
  return { pnl: 0, roi: 0, volume: 0 };
}

export type { ClosedPosition };
