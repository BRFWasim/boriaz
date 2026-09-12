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

      let frames: TimeframeFrame[] = [];
      try {
        frames = await analyzeCoinFrames(pos.coin, [
          { interval: "15m", horizon: "très court (15m)" },
          { interval: "1h", horizon: "court (1h)" },
          { interval: "4h", horizon: "moyen (4h)" },
        ]);
      } catch {
        frames = [];
      }

      const candlePx =
        frames.find((f) => f.interval === "1h")?.indicators?.price ??
        frames[0]?.indicators?.price ??
        0;
      const mid = mids[pos.coin.toUpperCase()] ?? 0;
      const price = mid > 0 ? mid : candlePx > 0 ? candlePx : entryPx;

      const movePct =
        pos.side === "long"
          ? ((price - entryPx) / entryPx) * 100
          : ((entryPx - price) / entryPx) * 100;
      const lev = pos.leverage || j?.leverage || 1;
      const pnlPct = movePct * lev;
      // TradeManageSnapshot.pnlEur stocke le $ pour le live (UI affiche $)
      const pnlUsd = pos.unrealizedPnlUsd;

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

      const previousSnapshot =
        j?.manageSnapshot ?? orphan[snapKey(pos.coin, pos.side)] ?? null;
      const lastAt = previousSnapshot?.at ?? 0;

      let snapshot: TradeManageSnapshot;
      let evaluatedAction: LiveManageDecision["action"];
      let evaluatedProviders: string[];

      if (!frames.length) {
        // Snapshot dégradé : ne jamais skip (sinon « Relecture en cours… »)
        snapshot = {
          at: Date.now(),
          action: previousSnapshot?.action ?? "wait",
          reason:
            previousSnapshot?.reason ??
            "Données TF indisponibles (HL lent/429) — PnL mid uniquement",
          price,
          pnlEur: Math.round(pnlUsd * 100) / 100,
          pnlPct: Math.round(pnlPct * 100) / 100,
          bias1h: previousSnapshot?.bias1h ?? "neutre",
          bias4h: previousSnapshot?.bias4h ?? "neutre",
          bias15m: previousSnapshot?.bias15m,
          support: previousSnapshot?.support ?? null,
          resistance: previousSnapshot?.resistance ?? null,
          providers: previousSnapshot
            ? [...(previousSnapshot.providers ?? []), "mid+PnL"]
            : ["mid+PnL"],
          outlook:
            previousSnapshot?.outlook ??
            "Surveillance dégradée : attendre le prochain scan complet.",
          side: pos.side,
          currency: "$",
          bullets: [
            "TF indisponibles — dernier avis conservé + PnL rafraîchi",
            ...(previousSnapshot?.bullets ?? []),
          ].slice(0, 8),
          smc: previousSnapshot?.smc,
          rawAction: previousSnapshot?.rawAction,
          actionSince: previousSnapshot?.actionSince,
          confirmCount: previousSnapshot?.confirmCount,
        };
        evaluatedAction = snapshot.action;
        evaluatedProviders = snapshot.providers;
      } else {
        const evaluated = await evaluateTradeManage({
          trade: stub,
          frames,
          price,
          pnl: { pnlPct, pnlEur: pnlUsd, movePct },
          skipAi: opts?.skipAi,
          skipSmc: opts?.skipSmc,
          lastSnapshotAt: lastAt,
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
      }

      if (j) {
        await updateLiveJournalEntry(j.id, { manageSnapshot: snapshot });
        // garder openJournal à jour localement
        const idx = openJournal.findIndex((e) => e.id === j.id);
        if (idx >= 0) {
          openJournal[idx] = { ...openJournal[idx]!, manageSnapshot: snapshot };
        }
      } else {
        orphan[snapKey(pos.coin, pos.side)] = snapshot;
      }

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
      // Une position en erreur ne doit pas bloquer les autres analyses
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
