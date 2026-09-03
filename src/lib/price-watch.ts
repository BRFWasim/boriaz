import { promises as fs } from "fs";
import path from "path";
import { parseNum } from "./format";
import { postInfo } from "./hyperliquid";
import { sendTelegramMessage } from "./telegram";

/** Tickers Hyperliquid (Uniswap = UNI). */
export const WATCHLIST = [
  { coin: "RENDER", label: "RENDER" },
  { coin: "ONDO", label: "ONDO" },
  { coin: "UNI", label: "UNISWAP" },
  { coin: "BTC", label: "BTC" },
  { coin: "SOL", label: "SOL" },
  { coin: "ETH", label: "ETH" },
  { coin: "HYPE", label: "HYPE" },
  { coin: "TAO", label: "TAO" },
] as const;

export type WatchCoin = (typeof WATCHLIST)[number]["coin"];

const STATE_FILE = path.join(process.cwd(), ".price-watch-state.json");
const SPIKE_PCT = 1.5;
/** Fenêtre « rapidement » pour un +1.5 %. */
const SPIKE_WINDOW_MS = 20 * 60_000;
const SPIKE_COOLDOWN_MS = 45 * 60_000;
const DIGEST_EVERY_MS = 2 * 60 * 60_000;
const SAMPLE_KEEP_MS = 3 * 60 * 60_000;
const MIN_POLL_GAP_MS = 15_000;

export interface PriceSample {
  t: number;
  px: number;
}

export interface WatchlistQuote {
  coin: string;
  label: string;
  price: number;
  change15mPct: number | null;
  change1hPct: number | null;
  change2hPct: number | null;
  change24hPct: number | null;
}

interface PriceWatchState {
  samples: Record<string, PriceSample[]>;
  lastSpikeAt: Record<string, number>;
  lastDigestAt: number;
  lastPollAt: number;
}

let memory: PriceWatchState | null = null;
let inflight: Promise<PriceWatchResult> | null = null;

export interface PriceWatchResult {
  quotes: WatchlistQuote[];
  digestSent: boolean;
  spikesSent: string[];
  errors: string[];
  nextDigestAt: number;
}

function emptyState(): PriceWatchState {
  return {
    samples: {},
    lastSpikeAt: {},
    lastDigestAt: 0,
    lastPollAt: 0,
  };
}

async function loadState(): Promise<PriceWatchState> {
  if (memory) return memory;
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as PriceWatchState;
    memory = {
      samples: parsed.samples ?? {},
      lastSpikeAt: parsed.lastSpikeAt ?? {},
      lastDigestAt: parsed.lastDigestAt ?? 0,
      lastPollAt: parsed.lastPollAt ?? 0,
    };
  } catch {
    memory = emptyState();
  }
  return memory;
}

async function saveState(state: PriceWatchState): Promise<void> {
  memory = state;
  try {
    await fs.writeFile(STATE_FILE, JSON.stringify(state), "utf8");
  } catch {
    // ignore disk errors in cloud sandbox
  }
}

export async function fetchWatchlistMids(): Promise<Record<string, number>> {
  const mids = await postInfo<Record<string, string>>({ type: "allMids" });
  const out: Record<string, number> = {};
  for (const { coin } of WATCHLIST) {
    const px = parseNum(mids[coin] ?? "");
    if (px > 0) out[coin] = px;
  }
  return out;
}

function changeSince(
  samples: PriceSample[],
  now: number,
  windowMs: number,
): number | null {
  const target = now - windowMs;
  let best: PriceSample | null = null;
  for (const s of samples) {
    if (s.t <= target) {
      if (!best || s.t > best.t) best = s;
    }
  }
  if (!best) {
    const oldest = samples[0];
    if (!oldest || now - oldest.t < windowMs * 0.5) return null;
    best = oldest;
  }
  const last = samples.at(-1);
  if (!last || best.px <= 0) return null;
  return ((last.px - best.px) / best.px) * 100;
}

function formatPxSmart(px: number): string {
  if (px >= 1000) return px.toFixed(0);
  if (px >= 10) return px.toFixed(2);
  if (px >= 1) return px.toFixed(3);
  return px.toFixed(4);
}

function fmtPct(v: number | null): string {
  if (v === null) return "n/d";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

function buildDigestText(quotes: WatchlistQuote[]): string {
  const lines = [
    "Bilan prix (2h)",
    new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC",
    "",
  ];
  for (const q of quotes) {
    lines.push(
      `${q.label} ${formatPxSmart(q.price)} · 2h ${fmtPct(q.change2hPct)} · 1h ${fmtPct(q.change1hPct)} · 15m ${fmtPct(q.change15mPct)}`,
    );
  }
  lines.push("", "Pas un conseil financier.");
  return lines.join("\n");
}

function buildSpikeText(q: WatchlistQuote, movePct: number): string {
  return [
    `Spike rapide ${q.label}`,
    `+${movePct.toFixed(2)}% sur ~20 min`,
    `Prix ${formatPxSmart(q.price)} · 1h ${fmtPct(q.change1hPct)} · 2h ${fmtPct(q.change2hPct)}`,
    "Pas un conseil financier.",
  ].join("\n");
}

/**
 * Poll mids, détecte spikes +1.5% rapides, envoie bilan 2h.
 * Idempotent / rate-limité — à brancher sur le refresh dashboard.
 */
export async function runPriceWatch(options?: {
  forceDigest?: boolean;
}): Promise<PriceWatchResult> {
  if (inflight) return inflight;
  inflight = (async () => {
    const errors: string[] = [];
    const spikesSent: string[] = [];
    let digestSent = false;
    const now = Date.now();
    const state = await loadState();

    if (now - state.lastPollAt < MIN_POLL_GAP_MS && !options?.forceDigest) {
      const quotes = buildQuotesFromState(state, now);
      return {
        quotes,
        digestSent: false,
        spikesSent: [],
        errors: [],
        nextDigestAt: state.lastDigestAt + DIGEST_EVERY_MS,
      };
    }

    let mids: Record<string, number> = {};
    try {
      mids = await fetchWatchlistMids();
    } catch (error) {
      errors.push(
        error instanceof Error ? error.message : "allMids indisponible",
      );
      return {
        quotes: [],
        digestSent: false,
        spikesSent: [],
        errors,
        nextDigestAt: state.lastDigestAt + DIGEST_EVERY_MS,
      };
    }

    for (const { coin } of WATCHLIST) {
      const px = mids[coin];
      if (!px) continue;
      const list = state.samples[coin] ?? [];
      list.push({ t: now, px });
      const cutoff = now - SAMPLE_KEEP_MS;
      state.samples[coin] = list.filter((s) => s.t >= cutoff);
    }
    state.lastPollAt = now;

    const quotes = buildQuotesFromState(state, now);

    for (const q of quotes) {
      const move = q.change15mPct;
      if (move === null || move < SPIKE_PCT) continue;
      const last = state.lastSpikeAt[q.coin] ?? 0;
      if (now - last < SPIKE_COOLDOWN_MS) continue;
      const result = await sendTelegramMessage(buildSpikeText(q, move));
      if (result.ok) {
        state.lastSpikeAt[q.coin] = now;
        spikesSent.push(q.coin);
      } else if (result.error) {
        errors.push(result.error);
      }
    }

    // Premier démarrage : arme l’horloge 2h sans spam immédiat.
    if (state.lastDigestAt === 0 && !options?.forceDigest) {
      state.lastDigestAt = now;
    }

    const due =
      options?.forceDigest || now - state.lastDigestAt >= DIGEST_EVERY_MS;
    if (due && quotes.length) {
      const result = await sendTelegramMessage(buildDigestText(quotes));
      if (result.ok) {
        state.lastDigestAt = now;
        digestSent = true;
      } else if (result.error) {
        errors.push(result.error);
      }
    }

    await saveState(state);
    return {
      quotes,
      digestSent,
      spikesSent,
      errors: [...new Set(errors)],
      nextDigestAt: state.lastDigestAt + DIGEST_EVERY_MS,
    };
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

function buildQuotesFromState(
  state: PriceWatchState,
  now: number,
): WatchlistQuote[] {
  return WATCHLIST.map(({ coin, label }) => {
    const samples = state.samples[coin] ?? [];
    const price = samples.at(-1)?.px ?? 0;
    return {
      coin,
      label,
      price,
      change15mPct: changeSince(samples, now, SPIKE_WINDOW_MS),
      change1hPct: changeSince(samples, now, 60 * 60_000),
      change2hPct: changeSince(samples, now, 2 * 60 * 60_000),
      change24hPct: changeSince(samples, now, 24 * 60 * 60_000),
    };
  }).filter((q) => q.price > 0);
}

export async function getWatchlistSnapshot(): Promise<{
  quotes: WatchlistQuote[];
  nextDigestAt: number;
  lastDigestAt: number;
}> {
  const state = await loadState();
  const now = Date.now();
  return {
    quotes: buildQuotesFromState(state, now),
    nextDigestAt: state.lastDigestAt + DIGEST_EVERY_MS,
    lastDigestAt: state.lastDigestAt,
  };
}
