/**
 * Relecture live des positions HL (même logique paper) — advisory only.
 * Persiste manageSnapshot sur le journal (et un cache coin:side pour orphelins).
 * Ne ferme PAS automatiquement les positions HL (contrairement au paper).
 */

import { analyzeCoinFrames } from "./market-analysis";
import { postInfo } from "./hyperliquid";
import { parseNum } from "./format";
import { fetchLivePortfolio } from "./hl-live";
import {
  loadLiveJournal,
  matchJournalToPosition,
  syncLiveJournalWithPositions,
  updateLiveJournalEntry,
} from "./live-journal";
import { evaluateTradeManage, type ManageAction } from "./manage-trades";
import { loadPrefs } from "./persist";
import { sendTelegramMessage } from "./telegram";
import type { PaperTrade, TradeManageSnapshot } from "./user-types";
import type { TimeframeFrame } from "./types";
import { kvBackend, kvGet, kvSet } from "./kv";
import { promises as fs } from "fs";
import { dataPath, ensureDataDir } from "./data-dir";

const SNAPS_KEY = "boriazbot:hl-live-manage-snaps";
const memSnaps = new Map<string, string>();

/** Budget TF par coin — le poll UI ne doit pas rester bloqué. */
const FRAMES_TIMEOUT_MS = 8_000;

export type LiveManageDecision = {
  coin: string;
  side: "long" | "short";
  action: ManageAction;
  reason: string;
  outlook: string;
  price: number;
  pnlUsd: number;
  providers: string[];
  journalId: string | null;
};

export type LiveManageResult = {
  reviewed: number;
  decisions: LiveManageDecision[];
  telegramSent: boolean;
  aiUsed: boolean;
  snapshots: Record<string, TradeManageSnapshot>;
};

function snapKey(coin: string, side: string): string {
  return `${coin.toUpperCase()}:${side}`;
}

async function loadOrphanSnaps(): Promise<Record<string, TradeManageSnapshot>> {
  try {
    let raw: string | null = null;
    if (kvBackend() === "upstash") {
      raw = await kvGet(SNAPS_KEY);
      if (raw) memSnaps.set(SNAPS_KEY, raw);
    }
    if (!raw) {
      try {
        raw = await fs.readFile(dataPath(".hl-live-manage-snaps.json"), "utf8");
        memSnaps.set(SNAPS_KEY, raw);
      } catch {
        raw = memSnaps.get(SNAPS_KEY) ?? null;
      }
    }
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, TradeManageSnapshot>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function saveOrphanSnaps(
  snaps: Record<string, TradeManageSnapshot>,
): Promise<void> {
  const raw = JSON.stringify(snaps);
  memSnaps.set(SNAPS_KEY, raw);
  if (kvBackend() === "upstash") await kvSet(SNAPS_KEY, raw);
  try {
    await ensureDataDir();
    await fs.writeFile(dataPath(".hl-live-manage-snaps.json"), raw, "utf8");
  } catch {
    /* EROFS */
  }
}

/** Snapshots pour l’API live-account (journal + orphelins). */
export async function loadLiveManageSnapshots(): Promise<
  Record<string, TradeManageSnapshot>
> {
  const out = await loadOrphanSnaps();
  const journal = await loadLiveJournal();
  for (const e of journal) {
    if (e.status !== "open" || !e.manageSnapshot) continue;
    out[snapKey(e.coin, e.side)] = e.manageSnapshot;
  }
  return out;
}

async function loadMids(): Promise<Record<string, number>> {
  try {
    const raw = (await postInfo({ type: "allMids" })) as Record<string, string>;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw || {})) {
      const n = parseNum(v);
      if (n > 0) out[k.toUpperCase()] = n;
    }
    return out;
  } catch {
    return {};
  }
}

function stubPaperFromLive(input: {
  coin: string;
  side: "long" | "short";
  entry: number;
  tp: number;
  sl: number;
  leverage: number;
  marginUsd: number;
  size: number;
  portfolioId: string;
  portfolioName: string;
}): PaperTrade {
  const notional = input.entry * input.size;
  const margin =
    input.marginUsd > 0
      ? input.marginUsd
      : input.leverage > 0
        ? notional / input.leverage
        : notional;
  const now = Date.now();
  return {
    id: `live-stub-${input.coin}-${input.side}`,
    closeNotified: false,
    feesEur: 0,
    openedAt: now,
    filledAt: now,
    coin: input.coin,
    side: input.side,
    entry: input.entry,
    tp: input.tp > 0 ? input.tp : input.entry * (input.side === "long" ? 1.02 : 0.98),
    sl: input.sl > 0 ? input.sl : input.entry * (input.side === "long" ? 0.98 : 1.02),
    leverage: input.leverage || 1,
    sizePct: 0,
    marginEur: margin,
    notionalEur: notional,
    entryMode: "market_now",
    status: "open",
    closedAt: null,
    exitPx: null,
    markPx: input.entry,
    pnlPct: 0,
    pnlEur: 0,
    note: "",
    portfolioId: input.portfolioId || "boriaz",
    portfolioName: input.portfolioName || "Live",
    justification: null,
  };
}


async function analyzeFramesWithTimeout(
  coin: string,
  ms: number,
): Promise<TimeframeFrame[]> {
  try {
    return await Promise.race([
      analyzeCoinFrames(coin, [
        { interval: "15m", horizon: "très court (15m)" },
        { interval: "1h", horizon: "court (1h)" },
        { interval: "4h", horizon: "moyen (4h)" },
      ]),
      new Promise<TimeframeFrame[]>((resolve) =>
        setTimeout(() => resolve([]), ms),
      ),
    ]);
  } catch {
    return [];
  }
}

function buildLiveFallbackSnapshot(input: {
  side: "long" | "short";
  price: number;
  pnlUsd: number;
  pnlPct: number;
  previous: TradeManageSnapshot | null;
}): TradeManageSnapshot {
  const { side, price, pnlUsd, pnlPct, previous } = input;
  const sign = pnlUsd >= 0 ? "+" : "";
  const action = previous?.action ?? (pnlPct <= -8 ? "wait" : "hold");
  return {
    at: Date.now(),
    action,
    reason: (
      previous?.reason ??
      `Live ${side.toUpperCase()} · mid ${price} · PnL ${sign}${pnlUsd.toFixed(2)} $ (${sign}${pnlPct.toFixed(1)} %)`
    ).slice(0, 280),
    price,
    pnlEur: Math.round(pnlUsd * 100) / 100,
    pnlPct: Math.round(pnlPct * 100) / 100,
    bias1h: previous?.bias1h ?? "neutre",
    bias4h: previous?.bias4h ?? "neutre",
    bias15m: previous?.bias15m,
    support: previous?.support ?? null,
    resistance: previous?.resistance ?? null,
    providers: previous
      ? Array.from(new Set([...(previous.providers ?? []), "mid+PnL"]))
      : ["mid+PnL"],
    outlook: (
      previous?.outlook ??
      (pnlUsd >= 0
        ? "Position en gain — laisser courir, surveiller structure au prochain scan."
        : "Position en perte — attendre confirmation multi-TF avant de couper.")
    ).slice(0, 280),
    side,
    currency: "$",
    bullets: [
      `${side.toUpperCase()} live · PnL ${sign}${pnlUsd.toFixed(2)} $ (${sign}${pnlPct.toFixed(1)} %)`,
      `Spot ~${price}`,
      previous
        ? "Dernier avis conservé — TF/SMC en rafraîchissement"
        : "Analyse mid+PnL immédiate — structure TF dès que HL répond",
      ...(previous?.bullets ?? []),
    ].slice(0, 8),
    smc: previous?.smc ?? null,
    rawAction: previous?.rawAction,
    actionSince: previous?.actionSince,
    confirmCount: previous?.confirmCount,
  };
}

/**
 * Relit chaque position HL ouverte : mid + TF + PnL $ → snapshot.
 * Advisory only — aucune clôture HL ici.
 */
export async function manageLivePositionReviews(opts?: {
  notify?: boolean;
  max?: number;
  skipAi?: boolean;
  /** Skip FVG/BOS (poll UI ~45s) — évite 429 HL. */
  skipSmc?: boolean;
}): Promise<LiveManageResult> {
  const prefs = await loadPrefs();
  const notify =
    opts?.notify !== false && prefs.telegramEnabled && !opts?.skipAi;

  const portfolio = await fetchLivePortfolio();
  if (!portfolio.ok || !portfolio.positions.length) {
    return {
      reviewed: 0,
      decisions: [],
      telegramSent: false,
      aiUsed: false,
      snapshots: await loadLiveManageSnapshots(),
    };
  }

  let openJournal = await syncLiveJournalWithPositions(
    portfolio.positions.map((p) => ({ coin: p.coin, side: p.side })),
  );
  // Recharger après sync
  openJournal = (await loadLiveJournal()).filter((e) => e.status === "open");

  const mids = await loadMids();
  const orphan = await loadOrphanSnaps();
  const decisions: LiveManageDecision[] = [];
  const notes: string[] = [];
  let aiUsed = false;
  const max = opts?.max ?? 8;

  for (const pos of portfolio.positions.slice(0, max)) {
    const key = snapKey(pos.coin, pos.side);
    try {
      const j = matchJournalToPosition(openJournal, pos.coin, pos.side);
      const entryPx = j?.entry && j.entry > 0 ? j.entry : pos.entryPx;
      const hasRealTp = Boolean(j?.tp && j.tp > 0);
      const hasRealSl = Boolean(j?.sl && j.sl > 0);
      const levelsAreReal = hasRealTp && hasRealSl;
      const tp = hasRealTp
        ? j!.tp
        : entryPx * (pos.side === "long" ? 1.25 : 0.75);
      const sl = hasRealSl
        ? j!.sl
        : entryPx * (pos.side === "long" ? 0.75 : 1.25);

      const mid = mids[pos.coin.toUpperCase()] ?? 0;
      const priceEarly = mid > 0 ? mid : entryPx;
      const movePctEarly =
        pos.side === "long"
          ? ((priceEarly - entryPx) / Math.max(entryPx, 1e-9)) * 100
          : ((entryPx - priceEarly) / Math.max(entryPx, 1e-9)) * 100;
      const lev = pos.leverage || j?.leverage || 1;
      const pnlPctEarly = movePctEarly * lev;
      const pnlUsd = pos.unrealizedPnlUsd;
      const previousSnapshot =
        j?.manageSnapshot ?? orphan[key] ?? null;

      // Snapshot immédiat (garantit l’UI même si HL candles timeout)
      let snapshot = buildLiveFallbackSnapshot({
        side: pos.side,
        price: priceEarly,
        pnlUsd,
        pnlPct: pnlPctEarly,
        previous: previousSnapshot,
      });
      orphan[key] = snapshot;
      await saveOrphanSnaps(orphan);

      const frames = await analyzeFramesWithTimeout(
        pos.coin,
        FRAMES_TIMEOUT_MS,
      );

      const candlePx =
        frames.find((f) => f.interval === "1h")?.indicators?.price ??
        frames[0]?.indicators?.price ??
        0;
      const price = mid > 0 ? mid : candlePx > 0 ? candlePx : entryPx;
      const movePct =
        pos.side === "long"
          ? ((price - entryPx) / Math.max(entryPx, 1e-9)) * 100
          : ((entryPx - price) / Math.max(entryPx, 1e-9)) * 100;
      const pnlPct = movePct * lev;

      const stub = stubPaperFromLive({
        coin: pos.coin,
        side: pos.side,
        entry: entryPx,
        tp,
        sl,
        leverage: lev,
        marginUsd: pos.marginUsedUsd,
        size: Math.abs(pos.size),
        portfolioId: j?.portfolioId || "boriaz",
        portfolioName: j?.portfolioName || j?.botLabel || "Live",
      });

      let evaluatedAction: LiveManageDecision["action"] = snapshot.action;
      let evaluatedProviders = snapshot.providers;

      if (frames.length) {
        try {
          const evaluated = await evaluateTradeManage({
            trade: stub,
            frames,
            price,
            pnl: { pnlPct, pnlEur: pnlUsd, movePct },
            skipAi: opts?.skipAi,
            skipSmc: opts?.skipSmc,
            lastSnapshotAt: previousSnapshot?.at ?? 0,
            previousSnapshot,
            levelsAreReal,
            currency: "$",
          });
          if (evaluated.aiUsed) aiUsed = true;
          snapshot = {
            ...evaluated.snapshot,
            pnlEur: Math.round(pnlUsd * 100) / 100,
            pnlPct: Math.round(pnlPct * 100) / 100,
            currency: "$",
            side: pos.side,
          };
          evaluatedAction = evaluated.action;
          evaluatedProviders = evaluated.providers;
        } catch {
          snapshot = {
            ...snapshot,
            price,
            pnlEur: Math.round(pnlUsd * 100) / 100,
            pnlPct: Math.round(pnlPct * 100) / 100,
            at: Date.now(),
          };
        }
      } else {
        snapshot = {
          ...snapshot,
          price,
          pnlEur: Math.round(pnlUsd * 100) / 100,
          pnlPct: Math.round(pnlPct * 100) / 100,
          at: Date.now(),
          bullets: [
            `${pos.side.toUpperCase()} live · PnL ${pnlUsd >= 0 ? "+" : ""}${pnlUsd.toFixed(2)} $ (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)} %)`,
            `Spot ~${price}`,
            "TF HL timeout/vides — avis mid+PnL (structure au prochain scan)",
            ...(previousSnapshot?.bullets ?? []),
          ].slice(0, 8),
        };
      }

      // Dual-write : orphelin toujours + journal si dispo
      orphan[key] = snapshot;
      if (j) {
        await updateLiveJournalEntry(j.id, { manageSnapshot: snapshot });
        const idx = openJournal.findIndex((e) => e.id === j.id);
        if (idx >= 0) {
          openJournal[idx] = { ...openJournal[idx]!, manageSnapshot: snapshot };
        }
      }
      await saveOrphanSnaps(orphan);

      decisions.push({
        coin: pos.coin,
        side: pos.side,
        action: evaluatedAction,
        reason: snapshot.reason,
        outlook: snapshot.outlook,
        price,
        pnlUsd,
        providers: evaluatedProviders,
        journalId: j?.id ?? null,
      });

      if (
        notify &&
        (evaluatedAction === "close" || evaluatedAction === "flip")
      ) {
        notes.push(
          [
            `📡 LIVE conseil · ${evaluatedAction === "flip" ? "bascule" : "sortie"} ${pos.side.toUpperCase()} ${pos.coin}`,
            `Spot ~${price} · PnL ${pnlUsd >= 0 ? "+" : ""}${pnlUsd.toFixed(2)} $`,
            snapshot.reason,
            "Advisory live — pas de clôture auto. Pas un conseil financier.",
          ].join("\n"),
        );
      }
    } catch {
      try {
        const entryPx = pos.entryPx > 0 ? pos.entryPx : 1;
        const mid = mids[pos.coin.toUpperCase()] ?? entryPx;
        const lev = pos.leverage || 1;
        const movePct =
          pos.side === "long"
            ? ((mid - entryPx) / entryPx) * 100
            : ((entryPx - mid) / entryPx) * 100;
        const snap = buildLiveFallbackSnapshot({
          side: pos.side,
          price: mid,
          pnlUsd: pos.unrealizedPnlUsd,
          pnlPct: movePct * lev,
          previous: orphan[key] ?? null,
        });
        snap.reason =
          "Erreur relecture — PnL mid affiché, nouvel essai au prochain scan";
        snap.providers = ["erreur", "mid+PnL"];
        orphan[key] = snap;
        await saveOrphanSnaps(orphan);
        decisions.push({
          coin: pos.coin,
          side: pos.side,
          action: snap.action,
          reason: snap.reason,
          outlook: snap.outlook,
          price: mid,
          pnlUsd: pos.unrealizedPnlUsd,
          providers: snap.providers,
          journalId: null,
        });
      } catch {
        /* ignore */
      }
    }
  }

  await saveOrphanSnaps(orphan);

  let telegramSent = false;
  for (const text of notes.slice(0, 6)) {
    const r = await sendTelegramMessage(text);
    telegramSent = telegramSent || r.ok;
  }

  return {
    reviewed: decisions.length,
    decisions,
    telegramSent,
    aiUsed,
    snapshots: await loadLiveManageSnapshots(),
  };
}
