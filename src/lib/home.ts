import {
  computePaperAccount,
  ensurePortfolios,
  loadBook,
  loadPaperTrades,
  loadPrefs,
  storageInfo,
} from "./persist";
import type {
  BookTrade,
  PaperAccount,
  PaperTrade,
  PortfolioProfile,
} from "./user-types";
import type { AlignmentScore } from "./alignment";
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
  entry: number | null;
  idealEntry: number | null;
  tp: number | null;
  sl: number | null;
  entryMode: "market_now" | "limit_wait" | null;
  entryHint: string | null;
  riskReward: number | null;
  closeSuggestion: string | null;
  invalidation: string | null;
  certainty: "haute" | "moyenne" | "basse" | null;
  tfSummary: string | null;
  crowdWr: number | null;
  alignment: AlignmentScore | null;
  blurb: string;
}

export interface PortfolioHomeView {
  profile: PortfolioProfile;
  account: PaperAccount;
  openTrades: PaperTrade[];
}

export interface HomePayload {
  cards: HomeCard[];
  best: DirectionSignal | null;
  divergences: string[];
  account: PaperAccount;
  paperOpen: PaperTrade[];
  paperAll: PaperTrade[];
  book: BookTrade[];
  portfolios: PortfolioHomeView[];
  storage: { backend: "upstash" | "tmp"; note: string };
  maxSafetyMode: boolean;
  fetchedAt: number;
  disclaimer: string;
  howto: {
    entry: string;
    paper: string;
    live: string;
  };
  warning: string | null;
}

export async function getHomeSnapshot(): Promise<HomePayload> {
  let warning: string | null = null;
  let signals: Awaited<ReturnType<typeof getTradeSignals>> | null = null;
  let quotes: Awaited<ReturnType<typeof getWatchlistSnapshot>> | null = null;

  try {
    quotes = await getWatchlistSnapshot();
  } catch (e) {
    warning = e instanceof Error ? e.message : "Prix indisponibles";
  }

  if (!quotes?.quotes?.length) {
    try {
      const { postInfo } = await import("./hyperliquid");
      const { parseNum } = await import("./format");
      const { WATCHLIST } = await import("./price-watch");
      const mids = (await postInfo({ type: "allMids" })) as Record<string, string>;
      quotes = {
        quotes: WATCHLIST.map((w) => ({
          coin: w.coin,
          label: w.label,
          price: parseNum(mids[w.coin] ?? "0"),
          change15mPct: null,
          change1hPct: null,
          change2hPct: null,
          change24hPct: null,
        })).filter((q) => q.price > 0),
        nextDigestAt: Date.now() + 2 * 3600_000,
        lastDigestAt: 0,
      };
      if (warning?.includes("429")) {
        warning =
          "HL rate-limit bougies — prix mids live OK, % 15m/2h en attente.";
      }
    } catch (e) {
      warning = e instanceof Error ? e.message : warning;
    }
  }

  try {
    signals = await getTradeSignals({ notify: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Signaux indisponibles";
    warning = warning ? `${warning} · ${msg}` : msg;
  }

  const prefs = await loadPrefs().catch(() => null);
  const portfolios = ensurePortfolios(prefs?.portfolios);
  const bankroll =
    portfolios.find((p) => p.isDefault)?.bankrollEur ||
    prefs?.paperBankrollEur ||
    1000;
  const paper = signals?.paper ?? (await loadPaperTrades().catch(() => []));
  const account = signals?.account ?? computePaperAccount(paper, bankroll);
  const storage = signals?.storage ?? storageInfo();
  const portfolioViews: PortfolioHomeView[] = portfolios
    .filter((p) => p.enabled)
    .map((p) => ({
      profile: p,
      account: {
        ...computePaperAccount(paper, p.bankrollEur, p.id),
        portfolioId: p.id,
        portfolioName: p.name,
      },
      openTrades: paper.filter(
        (t) =>
          (t.portfolioId || "default") === p.id &&
          (t.status === "open" || t.status === "pending"),
      ),
    }));

  const byCoin = new Map((signals?.signals ?? []).map((s) => [s.coin, s]));
  const openByCoin = new Map(
    paper
      .filter((p) => p.status === "open" || p.status === "pending")
      .map((p) => [p.coin, p]),
  );
  const cards: HomeCard[] = (quotes?.quotes ?? []).map((q) => {
    const sig = byCoin.get(q.coin);
    const frozen = openByCoin.get(q.coin);
    const meta = cryptoMeta(q.coin);
    return {
      coin: q.coin,
      label: q.label,
      logo: meta.logo,
      price: q.price,
      change15mPct: q.change15mPct,
      change2hPct: q.change2hPct,
      spotPhase: sig?.spotPhase ?? "neutre",
      direction: frozen
        ? frozen.side === "long"
          ? "long"
          : "short"
        : (sig?.action ?? "wait"),
      confidence: sig?.confidence ?? 0,
      leverage: frozen ? `${frozen.leverage}×` : (sig?.leverage ?? "—"),
      sizePct: frozen ? `${frozen.sizePct} %` : (sig?.sizePct ?? "—"),
      entry: frozen?.entry ?? sig?.entry ?? null,
      idealEntry: frozen?.entry ?? sig?.idealEntry ?? null,
      tp: frozen?.tp ?? sig?.tp ?? null,
      sl: frozen?.sl ?? sig?.sl ?? null,
      entryMode: frozen?.entryMode ?? sig?.entryMode ?? null,
      entryHint: frozen
        ? `FIGÉ jusqu’au TP/SL · spot live ${q.price}`
        : (sig?.entryHint ?? null),
      riskReward: sig?.riskReward ?? null,
      closeSuggestion: frozen ? null : (sig?.closeSuggestion ?? null),
      invalidation: sig?.invalidation ?? null,
      certainty: sig?.certainty ?? null,
      tfSummary: sig?.tfSummary ?? null,
      crowdWr: sig?.crowdWr ?? null,
      alignment: sig?.alignment ?? null,
      blurb: frozen
        ? `Trade figé ${frozen.side.toUpperCase()} · ${frozen.portfolioName || "Défaut"} · ${frozen.justification?.summary || frozen.note}`
        : sig?.aiText || sig?.reason || "Analyse en cours…",
    };
  });

  cards.sort(
    (a, b) =>
      (b.alignment?.score ?? 0) - (a.alignment?.score ?? 0) ||
      b.confidence - a.confidence,
  );

  return {
    cards,
    best: signals?.best ?? null,
    divergences: signals?.divergences ?? [],
    account,
    paperOpen: paper.filter(
      (p) => p.status === "open" || p.status === "pending",
    ),
    paperAll: paper.slice(0, 40),
    book: signals?.book ?? (await loadBook().catch(() => [])),
    portfolios: portfolioViews,
    storage,
    maxSafetyMode: signals?.maxSafetyMode ?? prefs?.maxSafetyMode !== false,
    fetchedAt: Date.now(),
    disclaimer:
      signals?.disclaimer ??
      "Suggestions éducatives. Paper = simulation multi-portefeuilles. Pas un conseil financier.",
    howto: {
      entry:
        "Alignement (TF × crowd × Nansen × IA) + gate IA. Chaque trade a une justification. Marché = maintenant ; Limite = attendre.",
      paper:
        "Portefeuille Défaut toujours actif + portefeuilles perso (Lab). Upstash garde le paper.",
      live: "Prix ~4 s. Signaux ~1–3 min. Tracking wallets + gate IA avant chaque simu.",
    },
    warning,
  };
}
