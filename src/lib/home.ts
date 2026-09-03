import { getTradeSignals, type DirectionSignal } from "./trade-signal";
import { getWatchlistSnapshot } from "./price-watch";
import { cryptoMeta } from "./crypto-meta";

export interface HomeCard {
  coin: string;
  label: string;
  logo: string;
  price: number;
  change15mPct: number | null;
  change2hPct: number | null;
  spotPhase: "achat" | "vente" | "neutre";
  direction: "long" | "short" | "wait";
  confidence: number;
  leverage: string;
  sizePct: string;
  blurb: string;
}

export interface HomePayload {
  cards: HomeCard[];
  best: DirectionSignal | null;
  fetchedAt: number;
  disclaimer: string;
}

export async function getHomeSnapshot(): Promise<HomePayload> {
  const [signals, quotes] = await Promise.all([
    getTradeSignals({ notify: false }),
    getWatchlistSnapshot(),
  ]);

  const byCoin = new Map(signals.signals.map((s) => [s.coin, s]));
  const cards: HomeCard[] = quotes.quotes.map((q) => {
    const sig = byCoin.get(q.coin);
    const meta = cryptoMeta(q.coin);
    return {
      coin: q.coin,
      label: q.label,
      logo: meta.logo,
      price: q.price,
      change15mPct: q.change15mPct,
      change2hPct: q.change2hPct,
      spotPhase: sig?.spotPhase ?? "neutre",
      direction: sig?.action ?? "wait",
      confidence: sig?.confidence ?? 0,
      leverage: sig?.leverage ?? "—",
      sizePct: sig?.sizePct ?? "—",
      blurb: sig?.aiText || sig?.reason || "Analyse en cours…",
    };
  });

  // Ordre watchlist fixe + prioriser signaux forts
  cards.sort((a, b) => b.confidence - a.confidence);

  return {
    cards,
    best: signals.best,
    fetchedAt: Date.now(),
    disclaimer: signals.disclaimer,
  };
}
