import { WATCHLIST, getWatchlistSnapshot, runPriceWatch } from "./price-watch";
import { analyzeCoinFrames, type CandleInterval } from "./market-analysis";
import { computeTradeLevels } from "./levels";
import { fetchNansenSnapshot } from "./nansen";
import { detectCrowdFlows } from "./crowd-flow";
import { getWhaleDashboard } from "./dashboard";
import { sendTelegramMessage } from "./telegram";
import { correlateSetup } from "./signal-score";
import { computeAlignment, type AlignmentScore } from "./alignment";
import {
  aggregatePaperAccount,
  appendBook,
  appendJournal,
  computePaperAccount,
  ensurePortfolios,
  inHushHours,
  loadPrefs,
  openPaperTrade,
  loadPaperTrades,
  loadBook,
  savePaperTrades,
  storageInfo,
  type PaperAccount,
  type PaperTrade,
  type PortfolioProfile,
  type TradeJustification,
} from "./persist";
import type { BookTrade } from "./user-types";
import type { EntryMode } from "./user-types";
import type { BuyTimingAction, SignalBias } from "./types";

export interface DirectionSignal {
  coin: string;
  action: "long" | "short" | "wait";
  confidence: number;
  certainty: "haute" | "moyenne" | "basse";
  leverage: string;
  sizePct: string;
  spotPhase: "achat" | "vente" | "neutre";
  bias: SignalBias;
  price: number;
  entry: number | null;
  idealEntry: number | null;
  tp: number | null;
  sl: number | null;
  entryMode: EntryMode | null;
  entryHint: string | null;
  riskReward: number | null;
  reason: string;
  aiText: string | null;
  /** true seulement si l’IA a confirmé ce trade (gate obligatoire). */
  aiVerified: boolean;
  aiVerifyNote: string | null;
  invalidation: string;
  closeSuggestion: string | null;
  /** Ex. "1h haussier · 4h neutre · 1d haussier" */
  tfSummary: string;
  alignedTf: number;
  crowdWr: number | null;
  /** Score unique Alignement (TF × crowd × Nansen × IA). */
  alignment: AlignmentScore;
  nansenLong: number;
  nansenShort: number;
  tfVotes: { interval: string; bias: SignalBias; score: number }[];
}

export interface TradeSignalPayload {
  signals: DirectionSignal[];
  best: DirectionSignal | null;
  divergences: string[];
  paper: PaperTrade[];
  account: PaperAccount;
  telegramSent: boolean;
  telegramError: string | null;
  storage: { backend: "upstash" | "tmp"; note: string };
  maxSafetyMode: boolean;
  book: BookTrade[];
  fetchedAt: number;
  disclaimer: string;
}

const CACHE_TTL = 3 * 60_000;
const TG_COOLDOWN = 25 * 60_000;
let cache: { at: number; value: TradeSignalPayload } | null = null;
let lastTgKey = "";
let lastTgAt = 0;

function leverageFor(confidence: number, adx: number | null, maxLev: number): string {
  let sug = 1;
  if (confidence >= 75 && (adx ?? 0) >= 25) sug = Math.min(3, maxLev);
  else if (confidence >= 60) sug = Math.min(2, maxLev);
  else sug = Math.min(1, maxLev);
  return `${sug}× (max prefs ${maxLev}×)`;
}

function sizeFor(confidence: number): string {
  if (confidence >= 75) return "1.5–2.5 % du capital";
  if (confidence >= 60) return "0.75–1.5 % du capital";
  return "0–0.5 % (passer / réduire)";
}

function spotPhaseFrom(
  action: BuyTimingAction,
  bias: SignalBias,
): "achat" | "vente" | "neutre" {
  if (action === "acheter_zone" || action === "surveiller_achat") return "achat";
  if (action === "eviter" || bias === "baissier") return "vente";
  return "neutre";
}

async function askSignalAi(compact: unknown[]): Promise<string | null> {
  const prompt = `Analyste crypto PRUDENT et CORRÉLÉ. FR. PAS un conseil financier.
Tu DOIS croiser : multi-TF (1h/4h/1d), crowd wallets à bon WR, Nansen.
Règle stricte : si 1h est HAUSSIER fort sur UNI/SOL/BTC et 4h n’est pas baissier fort → favorise LONG (sauf crowd short qualité contraire).
Ne propose un trade QUE si certainty haute ou confiance ≥70 avec alignement.
JSON strict:
{"action":"long"|"short"|"wait","coin":"UNI","confidence":0-100,"certainty":"haute"|"moyenne"|"basse","leverage":"2x","sizePct":"1% capital","entry":123.4,"tp":130,"sl":118,"entryMode":"market_now"|"limit_wait","reason":"...","invalidation":"...","detail":"3 phrases corrélant TF+wallets"}
Données: ${JSON.stringify(compact)}`;

  const anthropic = process.env.ANTHROPIC_API_KEY?.trim();
  if (anthropic) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": anthropic,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model:
            process.env.ANTHROPIC_MODEL?.trim() || "claude-haiku-4-5-20251001",
          max_tokens: 500,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const json = (await res.json()) as {
        content?: { type: string; text?: string }[];
      };
      if (res.ok) {
        return json.content?.find((c) => c.type === "text")?.text?.trim() || null;
      }
    } catch {
      // fallthrough
    }
  }

  const openai = process.env.OPENAI_API_KEY?.trim();
  if (!openai) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openai}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
        temperature: 0.15,
        max_tokens: 500,
        messages: [
          { role: "system", content: "JSON uniquement." },
          { role: "user", content: prompt },
        ],
      }),
    });
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return json.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}

function parseAiJson(text: string | null) {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as Record<string, unknown>;
    const action = String(obj.action || "wait").toLowerCase();
    if (action !== "long" && action !== "short" && action !== "wait") return null;
    const modeRaw = String(obj.entryMode || "").toLowerCase();
    const entryMode: EntryMode | null =
      modeRaw === "limit_wait"
        ? "limit_wait"
        : modeRaw === "market_now"
          ? "market_now"
          : null;
    return {
      action: action as "long" | "short" | "wait",
      coin: String(obj.coin || "").toUpperCase(),
      confidence: Number(obj.confidence ?? 0),
      leverage: String(obj.leverage || "1x"),
      sizePct: String(obj.sizePct || "≤1%"),
      entry: obj.entry != null ? Number(obj.entry) : null,
      tp: obj.tp != null ? Number(obj.tp) : null,
      sl: obj.sl != null ? Number(obj.sl) : null,
      entryMode,
      reason: String(obj.reason || ""),
      invalidation: String(obj.invalidation || ""),
      detail: String(obj.detail || obj.reason || ""),
    };
  } catch {
    return null;
  }
}

/** 2ᵉ passage IA : confirmer ou refuser le trade proposé avant paper/TG. */
async function verifyTradeWithAi(candidate: {
  coin: string;
  action: "long" | "short";
  confidence: number;
  alignment: number;
  tfSummary: string;
  crowdWr: number | null;
  entry: number | null;
  tp: number | null;
  sl: number | null;
  reason: string;
}): Promise<{
  approved: boolean;
  confidence: number;
  note: string;
}> {
  // Repli déterministe si aucune clé IA n'est configurée : au lieu de bloquer
  // tous les trades (ce qui gèle scalp/risqué/défaut), on valide sur des
  // critères objectifs (Alignement + R:R). Le gate IA strict reste actif dès
  // qu'une clé ANTHROPIC/OPENAI est présente.
  const hasAiProvider = Boolean(
    process.env.ANTHROPIC_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim(),
  );
  if (!hasAiProvider) {
    const reward =
      candidate.action === "long"
        ? (candidate.tp ?? 0) - (candidate.entry ?? 0)
        : (candidate.entry ?? 0) - (candidate.tp ?? 0);
    const risk =
      candidate.action === "long"
        ? (candidate.entry ?? 0) - (candidate.sl ?? 0)
        : (candidate.sl ?? 0) - (candidate.entry ?? 0);
    const rr = risk > 0 ? reward / risk : 0;
    const ok =
      candidate.alignment >= 55 && candidate.confidence >= 60 && rr >= 1.2;
    return {
      approved: ok,
      confidence: ok
        ? Math.max(candidate.confidence, 62)
        : Math.min(candidate.confidence, 55),
      note: ok
        ? `Gate déterministe ✓ (IA non configurée) — Align ${candidate.alignment} · R:R ${rr.toFixed(2)}`
        : `Gate déterministe ✗ (IA non configurée) — Align ${candidate.alignment} · R:R ${rr.toFixed(2)}`,
    };
  }

  const prompt = `Tu es le GATE final avant un paper trade. FR. PAS un conseil financier.
Règles STRICTES :
- approve=true UNIQUEMENT si TF 1h+4h (ou 1d) + crowd WR + niveaux TP/SL sont cohérents.
- Si doute, divergence, R:R faible, ou manque de confirmation → approve=false.
- confidence = ta note 0-100 après relecture.
JSON strict:
{"approve":true|false,"confidence":0-100,"note":"1-2 phrases"}
Trade proposé: ${JSON.stringify(candidate)}`;

  const anthropic = process.env.ANTHROPIC_API_KEY?.trim();
  let text: string | null = null;
  if (anthropic) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": anthropic,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model:
            process.env.ANTHROPIC_MODEL?.trim() || "claude-haiku-4-5-20251001",
          max_tokens: 220,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const json = (await res.json()) as {
        content?: { type: string; text?: string }[];
      };
      if (res.ok) {
        text = json.content?.find((c) => c.type === "text")?.text?.trim() || null;
      }
    } catch {
      /* fallthrough */
    }
  }
  if (!text) {
    const openai = process.env.OPENAI_API_KEY?.trim();
    if (openai) {
      try {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${openai}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
            temperature: 0.1,
            max_tokens: 220,
            messages: [
              { role: "system", content: "JSON uniquement." },
              { role: "user", content: prompt },
            ],
          }),
        });
        const json = (await res.json()) as {
          choices?: { message?: { content?: string } }[];
        };
        text = json.choices?.[0]?.message?.content?.trim() || null;
      } catch {
        text = null;
      }
    }
  }
  if (!text) {
    return {
      approved: false,
      confidence: 0,
      note: "IA indisponible — trade bloqué (vérif obligatoire).",
    };
  }
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    return { approved: false, confidence: 0, note: "Réponse IA illisible — bloqué." };
  }
  try {
    const obj = JSON.parse(match[0]) as Record<string, unknown>;
    const approved = Boolean(obj.approve);
    const confidence = Number(obj.confidence ?? 0);
    const note = String(obj.note || "");
    if (!approved || confidence < 62) {
      return {
        approved: false,
        confidence,
        note: note || "IA refuse ou confiance < 62.",
      };
    }
    return { approved: true, confidence, note: note || "IA confirme le setup." };
  } catch {
    return { approved: false, confidence: 0, note: "JSON IA invalide — bloqué." };
  }
}

const PENDING_EXPIRE_MS = 18 * 3600_000;

async function refreshPaperTrades(
  prices: Record<string, number>,
): Promise<{ paper: PaperTrade[]; closes: PaperTrade[] }> {
  const trades = await loadPaperTrades();
  const closes: PaperTrade[] = [];
  const now = Date.now();

  for (const t of trades) {
    const px = prices[t.coin];
    if (!px) continue;
    t.markPx = px;

    // Limite : fill si prix touche l’entrée
    if (t.status === "pending") {
      if (now - t.openedAt > PENDING_EXPIRE_MS) {
        t.status = "expired";
        t.closedAt = now;
        t.pnlPct = 0;
        t.pnlEur = 0;
        t.note = "Limite non touchée sous 18h — expirée";
        closes.push({ ...t });
        continue;
      }
      const hit =
        t.side === "long" ? px <= t.entry * 1.0005 : px >= t.entry * 0.9995;
      if (hit) {
        t.status = "open";
        t.filledAt = now;
        t.note = `Limite touchée @ ${px} — position ouverte`;
      } else {
        t.pnlPct = 0;
        t.pnlEur = 0;
        continue;
      }
    }

    if (t.status !== "open") continue;

    const movePct =
      t.side === "long"
        ? ((px - t.entry) / t.entry) * 100
        : ((t.entry - px) / t.entry) * 100;
    const pnlPct = movePct * t.leverage;
    const pnlEur = t.marginEur * (pnlPct / 100);
    t.pnlPct = pnlPct;
    t.pnlEur = pnlEur;

    let hit: PaperTrade["status"] | null = null;
    if (t.side === "long") {
      if (px >= t.tp) hit = "tp";
      else if (px <= t.sl) hit = "sl";
    } else {
      if (px <= t.tp) hit = "tp";
      else if (px >= t.sl) hit = "sl";
    }
    if (hit) {
      t.status = hit;
      t.closedAt = now;
      t.exitPx = px;
      t.note =
        hit === "tp"
          ? `TP touché — +${pnlEur.toFixed(2)} €`
          : hit === "sl"
            ? `SL touché — ${pnlEur.toFixed(2)} €`
            : `Invalidation — fermeture ${pnlEur.toFixed(2)} €`;
      closes.push({ ...t });
    } else if (pnlPct <= -4) {
      t.note = `Fermeture suggérée (paper ${pnlEur.toFixed(2)} € / ${pnlPct.toFixed(1)} %)`;
    }
  }

  await savePaperTrades(trades);
  return { paper: trades, closes };
}

export async function getTradeSignals(options?: {
  notify?: boolean;
  force?: boolean;
}): Promise<TradeSignalPayload> {
  if (!options?.force && cache && Date.now() - cache.at < CACHE_TTL) {
    return cache.value;
  }

  const prefs = await loadPrefs();

  try {
    await runPriceWatch();
  } catch {
    // ignore
  }

  const watch = WATCHLIST.filter((w) =>
    prefs.watchCoins.length ? prefs.watchCoins.includes(w.coin) : true,
  );

  const [quotes, nansen, dashboard] = await Promise.all([
    getWatchlistSnapshot(),
    fetchNansenSnapshot(),
    getWhaleDashboard().catch(() => null),
  ]);

  const crowd = dashboard ? detectCrowdFlows(dashboard.whales) : [];
  const priceMap: Record<string, number> = {};
  for (const q of quotes.quotes) priceMap[q.coin] = q.price;

  const { paper, closes } = await refreshPaperTrades(priceMap);

  // Notif Telegram TP/SL — INDÉPENDANTE du cron : une clôture est souvent
  // détectée par un appel non-notifiant (accueil), donc on prévient ici dès
  // qu'un trade est clôturé, une seule fois (flag closeNotified persistant).
  if (prefs.telegramEnabled && closes.length) {
    const toNotify = closes.filter((c) => !c.closeNotified);
    if (toNotify.length) {
      for (const c of toNotify.slice(0, 5)) {
        const head =
          c.status === "tp"
            ? "🟢 TP touché"
            : c.status === "sl"
              ? "🔴 SL touché"
              : c.status === "expired"
                ? "⚪️ Limite expirée"
                : "⚪️ Clôture";
        const pnl = c.pnlEur ?? 0;
        await sendTelegramMessage(
          [
            `${head} · ${c.side.toUpperCase()} ${c.coin}`,
            `Portefeuille « ${c.portfolioName || "Défaut"} »`,
            `Entrée ${c.entry} → sortie ${c.exitPx ?? c.markPx ?? "—"}`,
            `PnL ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} € (${(c.pnlPct ?? 0).toFixed(2)} %)`,
            c.note,
            "Simulation paper — pas un conseil financier.",
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }
      const ids = new Set(toNotify.map((c) => c.id));
      for (const t of paper) if (ids.has(t.id)) t.closeNotified = true;
      await savePaperTrades(paper);
    }
  }

  const signals: DirectionSignal[] = [];

  for (const { coin } of watch) {
    // Watchlist entière en multi-TF (1h + 4h + 1d)
    const frameSpecs: { interval: CandleInterval; horizon: string }[] = [
      { interval: "1h", horizon: "court (1h)" },
      { interval: "4h", horizon: "moyen (4h)" },
      { interval: "1d", horizon: "long (1d)" },
      { interval: "1w", horizon: "très long (1w)" },
    ];

    const frames = await analyzeCoinFrames(coin, frameSpecs);
    if (!frames.length) continue;

    const quote = quotes.quotes.find((q) => q.coin === coin);
    const crowdHit = crowd.find((c) => c.coin === coin);
    const nansenShort = nansen.recentPerpTrades.filter(
      (t) =>
        t.symbol.toUpperCase() === coin &&
        t.side.toLowerCase().includes("short"),
    ).length;
    const nansenLong = nansen.recentPerpTrades.filter(
      (t) =>
        t.symbol.toUpperCase() === coin &&
        t.side.toLowerCase().includes("long"),
    ).length;

    const corr = correlateSetup({
      coin,
      frames,
      crowd: crowdHit,
      nansenLong,
      nansenShort,
    });

    const action = corr.action;
    const confidence = corr.confidence;
    const main = corr.primary;
    const price = quote?.price ?? main.indicators.price;

    const vote1h = corr.tfVotes.find((v) => v.interval === "1h");
    const action1hHint: "long" | "short" | "wait" = vote1h
      ? vote1h.bias === "haussier" || vote1h.score >= 3
        ? "long"
        : vote1h.bias === "baissier" || vote1h.score <= -3
          ? "short"
          : "wait"
      : "wait";

    const alignment = computeAlignment({
      action,
      confidence,
      tfVotes: corr.tfVotes,
      crowd: crowdHit,
      nansenLong,
      nansenShort,
      iaConfidence: null,
      action1hHint,
    });

    let entry: number | null = null;
    let idealEntry: number | null = null;
    let tp: number | null = null;
    let sl: number | null = null;
    let entryMode: EntryMode | null = null;
    let entryHint: string | null = null;
    let riskReward: number | null = null;

    if (action === "long" || action === "short") {
      const lv = computeTradeLevels(
        action,
        price,
        main.indicators,
        confidence,
      );
      entry = lv.entry;
      idealEntry = lv.idealEntry;
      tp = lv.tp;
      sl = lv.sl;
      entryMode = lv.entryMode;
      entryHint = lv.entryHint;
      riskReward = lv.riskReward;
    }

    const openPaper = paper.find(
      (p) =>
        (p.status === "open" || p.status === "pending") && p.coin === coin,
    );
    const closeSuggestion =
      openPaper?.note?.includes("Fermeture") ||
      openPaper?.note?.includes("Invalidation")
        ? openPaper.note
        : null;

    const tfSummary = corr.tfVotes
      .map((v) => `${v.interval} ${v.bias}(${v.score})`)
      .join(" · ");

    const crowdWr =
      crowdHit && crowdHit.avgWinRate > 0
        ? crowdHit.avgWinRate <= 1.5
          ? crowdHit.avgWinRate * 100
          : crowdHit.avgWinRate
        : null;

    signals.push({
      coin,
      action,
      confidence: Math.min(92, confidence),
      certainty: corr.certainty,
      leverage: leverageFor(
        confidence,
        main.indicators.adx14,
        prefs.maxLeverage,
      ),
      sizePct: sizeFor(confidence),
      spotPhase: spotPhaseFrom(main.buyTiming.action, corr.bias),
      bias: corr.bias,
      price,
      entry,
      idealEntry,
      tp,
      sl,
      entryMode,
      entryHint,
      riskReward,
      reason: corr.reason,
      aiText: null,
      aiVerified: false,
      aiVerifyNote: null,
      invalidation: main.buyZone.summary,
      closeSuggestion,
      tfSummary,
      alignedTf: corr.alignedCount,
      crowdWr,
      alignment,
      nansenLong,
      nansenShort,
      tfVotes: corr.tfVotes,
    });
  }

  const compact = signals.map((s) => ({
    coin: s.coin,
    actionRule: s.action,
    confidence: s.confidence,
    certainty: s.certainty,
    alignment: s.alignment.score,
    alignmentParts: s.alignment.parts,
    bias: s.bias,
    tfSummary: s.tfSummary,
    alignedTf: s.alignedTf,
    crowdWr: s.crowdWr,
    price: s.price,
    entry: s.entry,
    idealEntry: s.idealEntry,
    entryMode: s.entryMode,
    tp: s.tp,
    sl: s.sl,
    reason: s.reason.slice(0, 180),
  }));

  const aiRaw = await askSignalAi([
    ...compact,
    {
      nansenTop: nansen.leaderboard.slice(0, 5).map((r) => ({
        label: r.label,
        pnl: Math.round(r.totalPnl),
        top: r.topCoin,
        side: r.topSide,
      })),
      crowd: crowd.slice(0, 6).map((c) => ({
        coin: c.coin,
        side: c.side,
        n: c.qualityWhaleCount,
      })),
    },
  ]);
  const ai = parseAiJson(aiRaw);

  let best: DirectionSignal | null =
    [...signals]
      .sort((a, b) => b.alignment.score - a.alignment.score || b.confidence - a.confidence)[0] ??
    null;

  if (ai && ai.action !== "wait" && ai.coin) {
    const target = signals.find((s) => s.coin === ai.coin) ?? best;
    if (target) {
      target.action = ai.action;
      target.confidence = Math.max(
        target.confidence,
        ai.confidence || target.confidence,
      );
      target.leverage = ai.leverage || target.leverage;
      target.sizePct = ai.sizePct || target.sizePct;
      target.aiText = ai.detail || ai.reason;
      if (target.confidence >= 72 && target.alignedTf >= 2) target.certainty = "haute";
      else if (target.confidence >= 60) target.certainty = "moyenne";
      target.reason = ai.reason || target.reason;
      target.invalidation = ai.invalidation || target.invalidation;
      if (ai.entryMode) target.entryMode = ai.entryMode;
      if (ai.entry && ai.entry > 0) target.entry = ai.entry;
      if (ai.tp && ai.tp > 0) target.tp = ai.tp;
      if (ai.sl && ai.sl > 0) target.sl = ai.sl;

      // Recalcule Alignement avec la partie IA
      const crowdHit = crowd.find((c) => c.coin === target.coin);
      const vote1h = target.tfVotes.find((v) => v.interval === "1h");
      target.alignment = computeAlignment({
        action: target.action,
        confidence: target.confidence,
        tfVotes: target.tfVotes,
        crowd: crowdHit,
        nansenLong: target.nansenLong,
        nansenShort: target.nansenShort,
        iaConfidence: ai.confidence || target.confidence,
        action1hHint: vote1h
          ? vote1h.bias === "haussier" || vote1h.score >= 3
            ? "long"
            : vote1h.bias === "baissier" || vote1h.score <= -3
              ? "short"
              : "wait"
          : "wait",
      });

      // Recalcule cohérent si manquant
      if (target.action === "long" || target.action === "short") {
        const lv = computeTradeLevels(
          target.action,
          target.price,
          {
            price: target.price,
            change24hPct: null,
            change7dPct: null,
            change30dPct: null,
            rsi14: null,
            macd: null,
            macdSignal: null,
            macdHist: null,
            ema20: null,
            ema50: null,
            ema200: null,
            sma20: null,
            sma50: null,
            atr14: target.price * 0.015,
            bbUpper: null,
            bbMiddle: null,
            bbLower: null,
            volumeAvg: null,
            support: null,
            resistance: null,
            stochK: null,
            stochD: null,
            roc12: null,
            adx14: null,
            volumeRatio: null,
          },
          target.confidence,
        );
        target.entry = target.entry ?? lv.entry;
        target.idealEntry = target.idealEntry ?? lv.idealEntry;
        target.tp = target.tp ?? lv.tp;
        target.sl = target.sl ?? lv.sl;
        target.entryMode = target.entryMode ?? lv.entryMode;
        target.entryHint = target.entryHint ?? lv.entryHint;
        target.riskReward = target.riskReward ?? lv.riskReward;

        if (
          (target.entryMode === "market_now" || target.confidence >= 62) &&
          target.entry &&
          Math.abs(target.entry - target.price) / target.price > 0.004
        ) {
          target.entry = target.price;
          target.entryMode = "market_now";
          target.entryHint = `Entrer MAINTENANT au marché (~${target.price}).`;
        }
      }
      best = target;
    }
  } else if (ai?.action === "wait" && best) {
    const d = best.tfVotes.find((v) => v.interval === "1d");
    const w = best.tfVotes.find((v) => v.interval === "1w");
    const longTermAgrees =
      best.action !== "wait" &&
      ((best.action === "long" &&
        (d?.bias === "haussier" || (d?.score ?? 0) >= 3) &&
        w?.bias !== "baissier") ||
        (best.action === "short" &&
          (d?.bias === "baissier" || (d?.score ?? 0) <= -3) &&
          w?.bias !== "haussier"));
    if (longTermAgrees) {
      best.aiText = `${ai.detail || "IA voulait WAIT"} · ignoré : 1d/1w alignés ${best.action.toUpperCase()}`;
    } else {
      best.action = "wait";
      best.aiText = ai.detail || "IA : patienter.";
      best.confidence = Math.min(best.confidence, ai.confidence || 40);
      best.entry = null;
      best.idealEntry = null;
      best.tp = null;
      best.sl = null;
      best.entryMode = null;
      best.entryHint = "Pas d’entrée — attendre un meilleur setup.";
      best.alignment = computeAlignment({
        action: "wait",
        confidence: best.confidence,
        tfVotes: best.tfVotes,
        crowd: crowd.find((c) => c.coin === best!.coin),
        nansenLong: best.nansenLong,
        nansenShort: best.nansenShort,
        iaConfidence: ai.confidence || 40,
        action1hHint: (() => {
          const v = best!.tfVotes.find((x) => x.interval === "1h");
          if (!v) return "wait";
          if (v.bias === "haussier" || v.score >= 3) return "long";
          if (v.bias === "baissier" || v.score <= -3) return "short";
          return "wait";
        })(),
      });
    }
  }

  // Prefère le meilleur Alignement pour le trade
  best =
    [...signals]
      .filter((s) => s.action !== "wait")
      .sort(
        (a, b) =>
          b.alignment.score - a.alignment.score || b.confidence - a.confidence,
      )[0] ?? best;

  // Gate IA obligatoire avant paper / TG signal
  if (
    best &&
    best.action !== "wait" &&
    best.entry &&
    best.tp &&
    best.sl
  ) {
    const gate = await verifyTradeWithAi({
      coin: best.coin,
      action: best.action,
      confidence: best.confidence,
      alignment: best.alignment.score,
      tfSummary: best.tfSummary,
      crowdWr: best.crowdWr,
      entry: best.entry,
      tp: best.tp,
      sl: best.sl,
      reason: best.reason.slice(0, 220),
    });
    best.aiVerified = gate.approved;
    best.aiVerifyNote = gate.note;
    if (gate.approved) {
      best.confidence = Math.max(best.confidence, gate.confidence);
      best.aiText = [best.aiText, `Vérif IA ✓ ${gate.note}`]
        .filter(Boolean)
        .join(" · ");
    } else {
      best.aiText = [best.aiText, `Vérif IA ✗ ${gate.note}`]
        .filter(Boolean)
        .join(" · ");
      // Bloque le paper : on garde le signal visible mais sans exécution
      best.certainty = best.certainty === "haute" ? "moyenne" : best.certainty;
    }
  } else if (best) {
    best.aiVerified = false;
    best.aiVerifyNote = "Pas de niveaux complets — vérif IA non lancée.";
  }

  const divergences = signals
    .map((s) => s.alignment.divergence)
    .filter((d): d is string => Boolean(d));

  let telegramSent = false;
  let telegramError: string | null = null;
  const notify = options?.notify !== false && prefs.telegramEnabled;
  const hush = inHushHours(prefs);
  const maxSafety = prefs.maxSafetyMode !== false;

  if (notify && !hush) {
    // Alertes divergence (throttle via clé)
    for (const d of divergences.slice(0, 2)) {
      const dKey = `div:${d.slice(0, 80)}`;
      if (dKey === lastTgKey && Date.now() - lastTgAt < TG_COOLDOWN) continue;
      const res = await sendTelegramMessage(
        [`⚠ DIVERGENCE`, d, "", "Pas un conseil financier."].join("\n"),
      );
      if (res.ok) {
        telegramSent = true;
        lastTgKey = dKey;
        lastTgAt = Date.now();
      } else telegramError = res.error ?? telegramError;
    }
  }

  const passesSafety =
    !maxSafety ||
    (best?.alignment.maxSafetyPass === true &&
      best.alignment.tf1h4hAligned &&
      best.alignment.crowdWrOk);

  const portfolios = ensurePortfolios(prefs.portfolios).filter(
    (p) => p.enabled && p.paperTradeEnabled && prefs.paperTradeEnabled,
  );
  const paperForCheck = await loadPaperTrades();

  function rrFor(
    action: "long" | "short",
    entry: number,
    tp: number,
    sl: number,
  ): number {
    const reward = action === "long" ? tp - entry : entry - tp;
    const risk = action === "long" ? entry - sl : sl - entry;
    return risk > 0 ? reward / risk : 0;
  }

  function tfAligned(
    signal: DirectionSignal,
    pf: PortfolioProfile,
  ): boolean {
    const focus =
      pf.timeframe === "15m"
        ? "1h"
        : pf.timeframe;
    const vote = signal.tfVotes.find((v) => v.interval === focus);
    if (!vote) return signal.alignedTf >= 1;
    if (signal.action === "long") {
      return vote.bias === "haussier" || vote.score >= 2;
    }
    return vote.bias === "baissier" || vote.score <= -2;
  }

  function buildJustification(
    signal: DirectionSignal,
    pf: PortfolioProfile,
  ): TradeJustification {
    const bullets = [
      `Alignement ${signal.alignment.score}/100 (${signal.alignment.label}) — ${signal.alignment.breakdown}`,
      signal.tfSummary ? `Multi-TF : ${signal.tfSummary}` : null,
      signal.crowdWr != null
        ? `Crowd wallets WR ~ ${signal.crowdWr.toFixed(0)} %`
        : "Crowd wallets : pas de consensus qualité",
      `Nansen long ${signal.nansenLong} / short ${signal.nansenShort}`,
      signal.aiVerified
        ? `Gate IA ✓ ${signal.aiVerifyNote || "confirmé"}`
        : `Gate IA ✗ ${signal.aiVerifyNote || "non confirmé"}`,
      `Portefeuille « ${pf.name} » · TF ${pf.timeframe} · risque ${pf.riskLevel}/5 · R:R min ${pf.minRR}`,
      signal.entryHint || null,
      `Invalidation : ${signal.invalidation}`,
    ].filter(Boolean) as string[];

    const summary = [
      `On lance ${signal.action.toUpperCase()} ${signal.coin} sur « ${pf.name} »`,
      `parce que Alignement ${signal.alignment.score}/100`,
      signal.aiVerified ? "et gate IA validée" : "mais gate IA absente",
      `· horizon ${pf.timeframe}`,
      signal.crowdWr != null
        ? `· crowd WR ${signal.crowdWr.toFixed(0)}%`
        : "",
      `.`,
    ]
      .filter(Boolean)
      .join(" ");

    return {
      summary,
      bullets,
      alignmentScore: signal.alignment.score,
      aiVerified: signal.aiVerified,
      aiNote: signal.aiVerifyNote,
      portfolioId: pf.id,
      portfolioName: pf.name,
      timeframe: pf.timeframe,
      triggeredAt: Date.now(),
    };
  }

  function portfolioAllows(
    signal: DirectionSignal,
    pf: PortfolioProfile,
  ): { ok: boolean; why: string } {
    if (signal.action === "wait" || !signal.entry || !signal.tp || !signal.sl) {
      return { ok: false, why: "Pas de setup actionnable" };
    }
    if (pf.requireAiGate && !signal.aiVerified) {
      return { ok: false, why: "Gate IA refusée / absente" };
    }
    const minAlign = pf.riskLevel <= 2 ? 58 : pf.riskLevel >= 5 ? 50 : 52;
    if (signal.alignment.score < minAlign) {
      return {
        ok: false,
        why: `Alignement ${signal.alignment.score} < ${minAlign} (risque ${pf.riskLevel})`,
      };
    }
    if (signal.confidence < (pf.riskLevel >= 4 ? 65 : 62) || signal.certainty === "basse") {
      return { ok: false, why: "Confiance trop basse pour ce risque" };
    }
    if (!tfAligned(signal, pf)) {
      return {
        ok: false,
        why: `TF focus ${pf.timeframe} non aligné avec ${signal.action}`,
      };
    }
    const rr = rrFor(signal.action, signal.entry, signal.tp, signal.sl);
    if (rr < pf.minRR) {
      return { ok: false, why: `R:R ${rr.toFixed(2)} < min ${pf.minRR}` };
    }
    if (pf.maxSafetyMode && !signal.alignment.tf1h4hAligned) {
      const dOk = signal.tfVotes.some(
        (v) =>
          v.interval === "1d" &&
          (v.bias === "haussier" || v.bias === "baissier"),
      );
      if (!dOk) return { ok: false, why: "Sureté max : 1h+4h / 1d manquant" };
    }
    const acc = computePaperAccount(
      paperForCheck,
      pf.bankrollEur,
      pf.id,
    );
    if (Number.isFinite(pf.maxLossEur) && pf.maxLossEur > 0) {
      const loss = pf.bankrollEur - acc.equityEur;
      if (loss >= pf.maxLossEur) {
        return { ok: false, why: `Perte max ${pf.maxLossEur} € atteinte` };
      }
    }
    if (pf.tradesPerDay > 0) {
      const today = paperForCheck.filter(
        (t) =>
          (t.portfolioId || "default") === pf.id &&
          Date.now() - t.openedAt < 24 * 3600_000,
      ).length;
      if (today >= pf.tradesPerDay) {
        return { ok: false, why: `Limite ${pf.tradesPerDay} trades/jour` };
      }
    }
    return { ok: true, why: "OK" };
  }

  // Gate IA par candidat (mémoïsé) : `best` est déjà passé au gate plus haut.
  const gatedCoins = new Set<string>();
  if (best) gatedCoins.add(`${best.coin}:${best.action}`);

  async function ensureAiGate(sig: DirectionSignal): Promise<void> {
    const key = `${sig.coin}:${sig.action}`;
    if (gatedCoins.has(key)) return;
    gatedCoins.add(key);
    if (sig.action === "wait" || !sig.entry || !sig.tp || !sig.sl) {
      sig.aiVerified = false;
      sig.aiVerifyNote = "Pas de niveaux complets — vérif IA non lancée.";
      return;
    }
    const g = await verifyTradeWithAi({
      coin: sig.coin,
      action: sig.action,
      confidence: sig.confidence,
      alignment: sig.alignment.score,
      tfSummary: sig.tfSummary,
      crowdWr: sig.crowdWr,
      entry: sig.entry,
      tp: sig.tp,
      sl: sig.sl,
      reason: sig.reason.slice(0, 220),
    });
    sig.aiVerified = g.approved;
    sig.aiVerifyNote = g.note;
    if (g.approved) sig.confidence = Math.max(sig.confidence, g.confidence);
  }

  // Chaque portefeuille choisit SA meilleure crypto éligible (et non plus la
  // seule `best` globale forcée partout) : c'est ce qui débloque scalp/risqué.
  const candidates = [...signals]
    .filter(
      (s) =>
        s.action !== "wait" &&
        s.entry != null &&
        s.tp != null &&
        s.sl != null &&
        s.confidence >= 60 &&
        s.certainty !== "basse",
    )
    .sort(
      (a, b) =>
        b.alignment.score - a.alignment.score || b.confidence - a.confidence,
    );

  let anyOpened = false;
  if (
    prefs.paperTradeEnabled !== false &&
    portfolios.length &&
    candidates.length
  ) {
    for (const pf of portfolios) {
      let chosen: DirectionSignal | null = null;
      for (const cand of candidates) {
        if (pf.requireAiGate) await ensureAiGate(cand);
        if (portfolioAllows(cand, pf).ok) {
          chosen = cand;
          break;
        }
      }
      if (!chosen) continue;
      const side = chosen.action === "short" ? "short" : "long";
      const justification = buildJustification(chosen, pf);
      const levNum = Math.min(
        pf.maxLeverage,
        Number(String(chosen.leverage).match(/[\d.]+/)?.[0] || 1),
      );
      const sizeNum = Math.max(1, Math.min(15, pf.sizePct || 10));
      const opened = await openPaperTrade({
        openedAt: Date.now(),
        coin: chosen.coin,
        side,
        entry: chosen.entry!,
        tp: chosen.tp!,
        sl: chosen.sl!,
        leverage: levNum,
        sizePct: sizeNum,
        entryMode: chosen.entryMode ?? "market_now",
        note: justification.summary,
        bankrollEur: pf.bankrollEur,
        markPx: chosen.price,
        portfolioId: pf.id,
        portfolioName: pf.name,
        justification,
      });
      if (opened && !opened.note.includes("Cash insuffisant")) {
        anyOpened = true;
        await appendBook({
          id: opened.id,
          at: opened.openedAt,
          coin: opened.coin,
          side: opened.side,
          entry: opened.entry,
          tp: opened.tp,
          sl: opened.sl,
          leverage: opened.leverage,
          marginEur: opened.marginEur,
          notionalEur: opened.notionalEur,
          sizePct: opened.sizePct,
          alignment: chosen.alignment.score,
          reason: justification.summary,
          portfolioId: pf.id,
          portfolioName: pf.name,
          justification,
        });
        await appendJournal({
          at: Date.now(),
          coin: chosen.coin,
          action: chosen.action,
          confidence: chosen.confidence,
          entry: chosen.entry!,
          tp: chosen.tp!,
          sl: chosen.sl!,
          leverage: `${levNum}×`,
          sizePct: `${sizeNum}%`,
          reason: justification.summary,
          source: `paper-sim:${pf.id}`,
          portfolioId: pf.id,
          justification: justification.bullets.join(" · "),
        });
      }
    }
  }

  const shouldSim = anyOpened;

  if (
    notify &&
    !hush &&
    shouldSim &&
    best &&
    best.confidence >= 70 &&
    best.alignment.score >= 55 &&
    passesSafety
  ) {
    const key = `${best.coin}:${best.action}:${Math.round(best.entry!)}:${Math.round(best.alignment.score / 5)}:${best.entryMode}`;
    if (key !== lastTgKey || Date.now() - lastTgAt > TG_COOLDOWN) {
      const paperNow = await loadPaperTrades();
      const latest = paperNow.find((t) => t.coin === best.coin) ?? null;
      const j = latest?.justification;
      const text = [
        `SIGNAL ${best.action.toUpperCase()} · ${best.coin}`,
        j?.summary || `Pourquoi : Align ${best.alignment.score} · IA ${best.aiVerified ? "OK" : "KO"}`,
        ...(j?.bullets ?? []).slice(0, 6),
        "",
        `Mode: ${best.entryMode === "limit_wait" ? "LIMITE" : "MARCHÉ"}`,
        `Entrée ~ ${best.entry} · TP ~ ${best.tp} · SL ~ ${best.sl}`,
        "",
        "Simulation paper — pas un ordre réel. Pas un conseil financier.",
      ]
        .filter(Boolean)
        .join("\n");
      const res = await sendTelegramMessage(text);
      telegramSent = res.ok || telegramSent;
      telegramError = res.error ?? telegramError;
      if (res.ok) {
        lastTgKey = key;
        lastTgAt = Date.now();
      }
    }
  }

  const paperLatest = await loadPaperTrades();
  const account = aggregatePaperAccount(
    paperLatest,
    ensurePortfolios(prefs.portfolios),
  );

  const value: TradeSignalPayload = {
    signals: signals.sort(
      (a, b) =>
        b.alignment.score - a.alignment.score || b.confidence - a.confidence,
    ),
    best,
    divergences,
    paper: paperLatest.slice(0, 40),
    account,
    telegramSent,
    telegramError,
    storage: storageInfo(),
    maxSafetyMode: maxSafety,
    book: await loadBook(),
    fetchedAt: Date.now(),
    disclaimer:
      "Suggestions éducatives (Alignement TF×crowd×Nansen×IA). Paper = simulation 1000 €. Pas un conseil financier.",
  };
  cache = { at: Date.now(), value };
  return value;
}
