import { getTradeSignals, type DirectionSignal } from "./trade-signal";
import { getWatchlistSnapshot } from "./price-watch";
import { cryptoMeta } from "./crypto-meta";
import type { PaperAccount, PaperTrade } from "./user-types";

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
  entry: number | null;
  idealEntry: number | null;
  tp: number | null;
  sl: number | null;
  entryMode: "market_now" | "limit_wait" | null;
  entryHint: string | null;
  riskReward: number | null;
  closeSuggestion: string | null;
  invalidation: string | null;
  blurb: string;
}

export interface HomePayload {
  cards: HomeCard[];
  best: DirectionSignal | null;
  account: PaperAccount;
  paperOpen: PaperTrade[];
  fetchedAt: number;
  disclaimer: string;
  howto: {
    entry: string;
    paper: string;
  };
}

export async function getHomeSnapshot(): Promise<HomePayload> {
  const [signals, quotes] = await Promise.all([
    getTradeSignals({ notify: true }),
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
      entry: sig?.entry ?? null,
      idealEntry: sig?.idealEntry ?? null,
      tp: sig?.tp ?? null,
      sl: sig?.sl ?? null,
      entryMode: sig?.entryMode ?? null,
      entryHint: sig?.entryHint ?? null,
      riskReward: sig?.riskReward ?? null,
      closeSuggestion: sig?.closeSuggestion ?? null,
      invalidation: sig?.invalidation ?? null,
      blurb: sig?.aiText || sig?.reason || "Analyse en cours…",
    };
  });

  cards.sort((a, b) => b.confidence - a.confidence);

  return {
    cards,
    best: signals.best,
    account: signals.account,
    paperOpen: signals.paper.filter(
      (p) => p.status === "open" || p.status === "pending",
    ),
    fetchedAt: Date.now(),
    disclaimer: signals.disclaimer,
    howto: {
      entry:
        "« Entrer maintenant » = ordre marché au prix affiché. « Limite » = poser un ordre au niveau entrée et attendre qu’il soit touché — ne force pas si le prix ne vient jamais.",
      paper:
        "Paper trade = simulation avec 1000 € de départ. Chaque signal ouvre une position virtuelle (marge % du capital × levier). Le PnL € montre ce que tu aurais gagné/perdu en suivant les trades.",
    },
  };
}
