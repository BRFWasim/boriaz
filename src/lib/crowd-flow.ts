import type {
  CrowdFlowSignal,
  HedgeAlert,
  PriorityAlert,
  Whale,
} from "./types";

/** Filtre qualité : winrate solide + échantillon + taille de compte. */
const MIN_WIN_RATE = 0.58; // fraction 0–1
const MIN_SAMPLE = 10;
const MIN_PORTFOLIO = 80_000;
/** Méga-wallets sans fills WR : inclus s’ils sont très gros. */
const MEGA_PORTFOLIO = 20_000_000;
const MIN_POSITION_USD = 20_000;
/** Ouverture « récente » pour un flux synchronisé. */
const FRESH_MS = 6 * 60 * 60_000;
/** Consensus : au moins N baleines qualité alignées. */
const MIN_CONSENSUS = 3;
/** Flux frais : au moins N ouvertures récentes même sens. */
const MIN_FRESH = 3;

export function isQualityWhale(whale: Whale): boolean {
  const wr = whale.tradeStats.winRate ?? whale.winRate;
  const sample = whale.tradeStats.sample || whale.winSample || 0;
  const wrOk =
    wr !== null && wr >= MIN_WIN_RATE && sample >= MIN_SAMPLE;
  const mega =
    whale.portfolioUsd >= MEGA_PORTFOLIO &&
    (wr === null || wr >= 0.45 || sample === 0);
  return (wrOk && whale.portfolioUsd >= MIN_PORTFOLIO) || mega;
}

/**
 * Détecte quand plusieurs gros wallets à bon winrate shortent (ou longent)
 * le même actif — surtout s’ils ouvrent dans une fenêtre courte.
 */
export function detectCrowdFlows(whales: Whale[]): CrowdFlowSignal[] {
  type Bucket = {
    coin: string;
    side: "long" | "short";
    whales: {
      alias: string;
      address: string;
      notional: number;
      winRate: number;
      openedAt: number | null;
      fresh: boolean;
    }[];
  };

  const map = new Map<string, Bucket>();
  const now = Date.now();

  for (const whale of whales) {
    if (!isQualityWhale(whale)) continue;
    const wr = whale.tradeStats.winRate ?? whale.winRate ?? 0;
    const wrFrac = wr > 1.5 ? wr / 100 : wr;
    for (const pos of whale.positions) {
      if (pos.notionalUsd < MIN_POSITION_USD) continue;
      const key = `${pos.coin}:${pos.side}`;
      const bucket = map.get(key) ?? {
        coin: pos.coin,
        side: pos.side,
        whales: [],
      };
      const fresh =
        pos.openedAt !== null && now - pos.openedAt <= FRESH_MS;
      bucket.whales.push({
        alias: whale.alias,
        address: whale.address,
        notional: pos.notionalUsd,
        winRate: wrFrac,
        openedAt: pos.openedAt,
        fresh,
      });
      map.set(key, bucket);
    }
  }

  const signals: CrowdFlowSignal[] = [];

  for (const bucket of map.values()) {
    const qualityCount = bucket.whales.length;
    const freshCount = bucket.whales.filter((w) => w.fresh).length;
    const notionalUsd = bucket.whales.reduce((a, w) => a + w.notional, 0);
    const avgWinRateRaw = bucket.whales
      .map((w) => w.winRate)
      .filter((w) => w > 0.05);
    const avgWinRate =
      avgWinRateRaw.length > 0
        ? avgWinRateRaw.reduce((a, w) => a + w, 0) / avgWinRateRaw.length
        : 0;
    const avgWinPct = avgWinRate <= 1.5 ? avgWinRate * 100 : avgWinRate;
    const aliases = [...new Set(bucket.whales.map((w) => w.alias))].slice(0, 6);

    const isFreshFlow = freshCount >= MIN_FRESH;
    const isConsensus = qualityCount >= MIN_CONSENSUS;
    if (!isFreshFlow && !isConsensus) continue;

    const kind = isFreshFlow ? "fresh_flow" : "consensus";
    const severity = isFreshFlow && qualityCount >= MIN_CONSENSUS ? "critical" : "warn";

    const actionHint =
      bucket.side === "short"
        ? isFreshFlow
          ? "Flux short synchronisé : plutôt éviter les longs agressifs / surveiller un short."
          : "Consensus short des wallets qualité : biais baissier à surveiller."
        : isFreshFlow
          ? "Flux long synchronisé : plutôt éviter de shorter / surveiller un long."
          : "Consensus long des wallets qualité : biais haussier à surveiller.";

    const summary =
      bucket.side === "short"
        ? `${qualityCount} wallets qualité short ${bucket.coin} (~${fmtUsd(notionalUsd)}$)${freshCount ? ` · ${freshCount} ouvertures < 6h` : ""} · WR moy. ${avgWinPct.toFixed(0)} %`
        : `${qualityCount} wallets qualité long ${bucket.coin} (~${fmtUsd(notionalUsd)}$)${freshCount ? ` · ${freshCount} ouvertures < 6h` : ""} · WR moy. ${avgWinPct.toFixed(0)} %`;

    signals.push({
      id: `crowd:${bucket.coin}:${bucket.side}:${kind}`,
      coin: bucket.coin,
      side: bucket.side,
      kind,
      severity,
      whaleCount: qualityCount,
      qualityWhaleCount: qualityCount,
      freshCount,
      notionalUsd,
      avgWinRate: avgWinPct,
      aliases,
      actionHint,
      summary,
    });
  }

  return signals.sort((a, b) => {
    const sev = (s: CrowdFlowSignal) => (s.severity === "critical" ? 2 : 1);
    return sev(b) - sev(a) || b.notionalUsd - a.notionalUsd;
  });
}

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toFixed(0);
}

/**
 * Alertes UI prioritaires. Telegram directionnel = module trade-signal (pas ici).
 * Short+spot : UI seulement, JAMAIS Telegram.
 */
export function buildPriorityAlerts(input: {
  hedgeAlerts: HedgeAlert[];
  crowdFlows: CrowdFlowSignal[];
  spotByAlertId?: Map<string, number>;
}): PriorityAlert[] {
  const out: PriorityAlert[] = [];

  for (const flow of input.crowdFlows) {
    // Crowd visible en UI ; Telegram LONG/SHORT géré par trade-signal + IA
    out.push(toPriorityFromCrowd(flow, false));
  }

  for (const alert of input.hedgeAlerts) {
    if (alert.kind === "long_with_spot") continue;

    if (alert.kind === "short_with_spot") {
      const spotUsd = estimateSpotUsd(alert);
      const perpUsd = alert.perpNotionalUsd ?? 0;
      if (spotUsd >= 5_000) {
        out.push({
          id: `prio:${alert.id}`,
          source: "hedge",
          severity: spotUsd >= 15_000 ? "critical" : "warn",
          title: alert.title,
          detail: alert.detail,
          coin: alert.baseAsset,
          notifyTelegram: false, // jamais — demandé par l’utilisateur
          tags: [
            "short+spot",
            "UI only",
            `spot~${fmtUsd(spotUsd)}$`,
            `perp~${fmtUsd(perpUsd)}$`,
          ],
        });
      }
      continue;
    }

    if (alert.kind === "spot_only_accumulation") {
      const spotUsd = estimateSpotUsd(alert);
      if (spotUsd >= 25_000) {
        out.push({
          id: `prio:${alert.id}`,
          source: "hedge",
          severity: "warn",
          title: alert.title,
          detail: alert.detail,
          coin: alert.baseAsset,
          notifyTelegram: false,
          tags: ["accumulation", "UI only", `spot~${fmtUsd(spotUsd)}$`],
        });
      }
    }
  }

  return out.sort((a, b) => {
    const rank = (s: PriorityAlert["severity"]) =>
      s === "critical" ? 3 : s === "warn" ? 2 : 1;
    return rank(b.severity) - rank(a.severity);
  });
}

function toPriorityFromCrowd(
  flow: CrowdFlowSignal,
  notifyTelegram: boolean,
): PriorityAlert {
  return {
    id: `prio:${flow.id}`,
    source: "crowd",
    severity: flow.severity,
    title:
      flow.side === "short"
        ? `Crowd SHORT ${flow.coin}`
        : `Crowd LONG ${flow.coin}`,
    detail: `${flow.summary}. ${flow.actionHint}`,
    coin: flow.coin,
    notifyTelegram:
      notifyTelegram ||
      (flow.kind === "fresh_flow" && flow.freshCount >= MIN_FRESH),
    tags: [
      flow.kind,
      flow.side,
      `${flow.qualityWhaleCount} wallets`,
      `WR ${flow.avgWinRate.toFixed(0)}%`,
    ],
  };
}

function estimateSpotUsd(alert: HedgeAlert): number {
  if (alert.spotValueUsd > 0) return alert.spotValueUsd;
  if (alert.spotAvgPx !== null && alert.spotQty > 0) {
    return alert.spotAvgPx * alert.spotQty;
  }
  return 0;
}
