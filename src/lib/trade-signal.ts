import { WATCHLIST, getWatchlistSnapshot, runPriceWatch } from "./price-watch";
import { analyzeCoinFrames, type CandleInterval } from "./market-analysis";
import { computeTradeLevels } from "./levels";
import { fetchNansenSnapshot } from "./nansen";
import { detectCrowdFlows } from "./crowd-flow";
import { getWhaleDashboard } from "./dashboard";
import { sendTelegramMessage } from "./telegram";
import { correlateSetup } from "./signal-score";
import { computeAlignment, type AlignmentScore } from "./alignment";
import { stabilizeDirection } from "./signal-sticky";
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
  /** Scan SMC portefeuille Boriaz (Claude Haiku). */
  smc: import("./smc-scan").SmcScanResult | null;
}

const CACHE_TTL = 5 * 60_000;
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
Favorise aussi les SHORT quand 4h+1d baissiers. Pas de flip 1h seul.
Ne propose un trade QUE si certainty haute ou confiance ≥70 avec alignement 1h+4h.
JSON strict:
{"action":"long"|"short"|"wait","coin":"UNI","confidence":0-100,"certainty":"haute"|"moyenne"|"basse","leverage":"2x","sizePct":"1% capital","entry":123.4,"tp":130,"sl":118,"entryMode":"market_now"|"limit_wait","reason":"...","invalidation":"...","detail":"3 phrases corrélant TF+wallets"}
Données: ${JSON.stringify(compact)}`;

  // --- Claude Haiku désactivé (commenté) ---
  // const anthropic = process.env.ANTHROPIC_API_KEY?.trim();
  // if (anthropic) {
  //   try {
  //     const res = await fetch("https://api.anthropic.com/v1/messages", {
  //       method: "POST",
  //       headers: {
  //         "x-api-key": anthropic,
  //         "anthropic-version": "2023-06-01",
  //         "Content-Type": "application/json",
  //       },
  //       body: JSON.stringify({
  //         model:
  //           process.env.ANTHROPIC_MODEL?.trim() || "claude-haiku-4-5-20251001",
  //         max_tokens: 500,
  //         messages: [{ role: "user", content: prompt }],
  //       }),
  //     });
  //     const json = (await res.json()) as {
  //       content?: { type: string; text?: string }[];
  //     };
  //     if (res.ok) {
  //       return json.content?.find((c) => c.type === "text")?.text?.trim() || null;
  //     }
  //   } catch {
  //     // fallthrough
  //   }
  // }

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
  // Gate déterministe (Claude commenté). OpenAI optionnel en second.
  // --- Claude Haiku désactivé ---
  // const anthropic = process.env.ANTHROPIC_API_KEY?.trim();
  // ...

  const reward =
    candidate.action === "long"
      ? (candidate.tp ?? 0) - (candidate.entry ?? 0)
      : (candidate.entry ?? 0) - (candidate.tp ?? 0);
  const riskAmt =
    candidate.action === "long"
      ? (candidate.entry ?? 0) - (candidate.sl ?? 0)
      : (candidate.sl ?? 0) - (candidate.entry ?? 0);
  const rr = riskAmt > 0 ? reward / riskAmt : 0;
  const mechOk =
    candidate.alignment >= 55 && candidate.confidence >= 60 && rr >= 1.2;

  const openai = process.env.OPENAI_API_KEY?.trim();
  let text: string | null = null;
  if (openai) {
    const prompt = `Tu es le GATE final avant un paper trade. FR. PAS un conseil financier.
Règles STRICTES :
- approve=true UNIQUEMENT si TF 1h+4h (ou 1d) + niveaux TP/SL cohérents.
- Favorise SHORT si 4h+1d baissiers. Refuse les flips 1h seuls.
- Si doute → approve=false.
JSON strict:
{"approve":true|false,"confidence":0-100,"note":"1-2 phrases"}
Trade proposé: ${JSON.stringify(candidate)}`;
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

  if (!text) {
    return {
      approved: mechOk,
      confidence: mechOk
        ? Math.max(candidate.confidence, 62)
        : Math.min(candidate.confidence, 55),
      note: mechOk
        ? `Gate mécanique ✓ Align ${candidate.alignment} · R:R ${rr.toFixed(2)} (Claude off)`
        : `Gate mécanique ✗ Align ${candidate.alignment} · R:R ${rr.toFixed(2)}`,
    };
  }
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    return {
      approved: mechOk,
      confidence: mechOk ? candidate.confidence : 0,
      note: mechOk
        ? "OpenAI illisible — repli mécanique ✓"
        : "OpenAI illisible — repli mécanique ✗",
    };
  }
  try {
    const obj = JSON.parse(match[0]) as Record<string, unknown>;
    const approved = Boolean(obj.approve);
    const confidence = Number(obj.confidence ?? 0);
    const note = String(obj.note || "");
    if (!approved || confidence < 62) {
      // Si OpenAI refuse mais mécanique solide + alignement fort → laisse passer
      if (mechOk && candidate.alignment >= 62) {
        return {
          approved: true,
          confidence: Math.max(candidate.confidence, 62),
          note: `OpenAI prudent mais mécanique OK (Align ${candidate.alignment})`,
        };
      }
      return {
        approved: false,
        confidence,
        note: note || "IA refuse ou confiance < 62.",
      };
    }
    return { approved: true, confidence, note: note || "IA confirme le setup." };
  } catch {
    return {
      approved: mechOk,
      confidence: mechOk ? candidate.confidence : 0,
      note: mechOk ? "JSON IA invalide — mécanique ✓" : "JSON IA invalide — bloqué.",
    };
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

    const qtyPct = t.remainingQtyPct ?? 1;
    const movePct =
      t.side === "long"
        ? ((px - t.entry) / t.entry) * 100
        : ((t.entry - px) / t.entry) * 100;
    const pnlPct = movePct * t.leverage;
    // PnL NET des frais estimés (aller-retour) → équité réaliste.
    // Après TP1 SMC : marge restante + partial déjà réalisé.
    const unrealizedEur = t.marginEur * (pnlPct / 100) * qtyPct;
    const feesShare = (t.feesEur ?? 0) * qtyPct;
    const pnlEur =
      unrealizedEur - feesShare + (t.realizedPartialEur ?? 0);
    t.pnlPct = pnlPct;
    t.pnlEur = pnlEur;

    // SMC : TP1 (1R) → clôturer 50 % + Break-Even, puis TP2 sur le reste
    const tp1 = t.tp1 != null && t.tp1 > 0 ? t.tp1 : null;
    const tp2 = t.tp2 != null && t.tp2 > 0 ? t.tp2 : null;
    const isSmc = t.strategy === "smc" || (tp1 != null && tp2 != null);

    if (isSmc && tp1 != null && !t.tp1Hit) {
      const hitTp1 =
        t.side === "long" ? px >= tp1 : px <= tp1;
      if (hitTp1) {
        const halfMargin = t.marginEur * 0.5;
        const halfMove =
          t.side === "long"
            ? ((tp1 - t.entry) / t.entry) * 100
            : ((t.entry - tp1) / t.entry) * 100;
        const halfPnl = halfMargin * ((halfMove * t.leverage) / 100);
        const halfFees = (t.feesEur ?? 0) * 0.5;
        t.realizedPartialEur = (t.realizedPartialEur ?? 0) + halfPnl - halfFees;
        t.marginEur = halfMargin;
        t.notionalEur = halfMargin * t.leverage;
        t.remainingQtyPct = 0.5;
        t.tp1Hit = true;
        t.sl = t.entry; // Break-even absolu
        t.tp = tp2 ?? t.tp;
        t.feesEur = halfFees; // frais restants sur demi-position
        t.note = `TP1 50% @ ${tp1} (+${(halfPnl - halfFees).toFixed(2)} €) · SL → BE · vise TP2`;
        t.pnlEur =
          t.realizedPartialEur +
          t.marginEur * (pnlPct / 100) -
          (t.feesEur ?? 0);
        continue;
      }
    }

    // SL / TP final (TP2 après BE, ou TP simple)
    const activeTp = t.tp1Hit && tp2 != null ? tp2 : t.tp;
    let hit: PaperTrade["status"] | null = null;
    if (t.side === "long") {
      if (px >= activeTp) hit = "tp";
      else if (px <= t.sl) hit = "sl";
    } else {
      if (px <= activeTp) hit = "tp";
      else if (px >= t.sl) hit = "sl";
    }
    if (hit) {
      t.status = hit;
      t.closedAt = now;
      t.exitPx = px;
      const finalUnreal = t.marginEur * (pnlPct / 100) - (t.feesEur ?? 0);
      const totalEur = (t.realizedPartialEur ?? 0) + finalUnreal;
      t.pnlEur = totalEur;
      const beNote = t.tp1Hit && hit === "sl" ? " (BE après TP1)" : "";
      t.note =
        hit === "tp"
          ? `${t.tp1Hit ? "TP2" : "TP"} touché — +${totalEur.toFixed(2)} €`
          : hit === "sl"
            ? `SL touché${beNote} — ${totalEur.toFixed(2)} €`
            : `Invalidation — fermeture ${totalEur.toFixed(2)} €`;
      closes.push({ ...t });
    } else if (pnlPct <= -4 && !t.tp1Hit) {
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

    let action = corr.action;
    let confidence = corr.confidence;
    const main = corr.primary;
    const price = quote?.price ?? main.indicators.price;

    const vote1h = corr.tfVotes.find((v) => v.interval === "1h");
    const vote4h = corr.tfVotes.find((v) => v.interval === "4h");
    const action1hHint: "long" | "short" | "wait" = vote1h
      ? vote1h.bias === "haussier" || vote1h.score >= 3
        ? "long"
        : vote1h.bias === "baissier" || vote1h.score <= -3
          ? "short"
          : "wait"
      : "wait";

    const side4h =
      vote4h &&
      (vote4h.bias === "haussier" || vote4h.score >= 3
        ? "long"
        : vote4h.bias === "baissier" || vote4h.score <= -3
          ? "short"
          : "wait");
    const sticky = stabilizeDirection({
      coin,
      action,
      confidence,
      tf1h4hAligned: Boolean(
        action !== "wait" && side4h && side4h === action,
      ),
      tf4hOpposed: Boolean(
        action !== "wait" &&
          side4h &&
          side4h !== "wait" &&
          side4h !== action,
      ),
    });
    if (sticky.stickyNote) {
      corr.reason = `${corr.reason} · ${sticky.stickyNote}`;
    }
    action = sticky.action;
    confidence = sticky.confidence;

    // Recalcule certainty si sticky a forcé WAIT
    let certainty = corr.certainty;
    if (action === "wait" && sticky.stickyNote?.includes("Anti-flip")) {
      certainty = "moyenne";
    } else if (action !== corr.action) {
      certainty = confidence >= 72 ? "haute" : confidence >= 62 ? "moyenne" : "basse";
    }

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

    const bias =
      action === "long" ? "haussier" : action === "short" ? "baissier" : "neutre";

    signals.push({
      coin,
      action,
      confidence: Math.min(92, confidence),
      certainty,
      leverage: leverageFor(
        confidence,
        main.indicators.adx14,
        prefs.maxLeverage,
      ),
      sizePct: sizeFor(confidence),
      spotPhase: spotPhaseFrom(main.buyTiming.action, bias),
      bias,
      price,
      entry,
      idealEntry,
      tp,
      sl,
      entryMode,
      entryHint,
      riskReward,
      reason: corr.reason,
      aiText: sticky.stickyNote,
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

      // Anti-flip : l'IA ne peut pas basculer sans 4h aligné
      const v4 = target.tfVotes.find((v) => v.interval === "4h");
      let side4: "long" | "short" | "wait" = "wait";
      if (v4) {
        if (v4.bias === "haussier" || v4.score >= 3) side4 = "long";
        else if (v4.bias === "baissier" || v4.score <= -3) side4 = "short";
      }
      const act = target.action as "long" | "short" | "wait";
      const stickyAi = stabilizeDirection({
        coin: target.coin,
        action: act,
        confidence: target.confidence,
        tf1h4hAligned: act !== "wait" && side4 === act,
        tf4hOpposed: act !== "wait" && side4 !== "wait" && side4 !== act,
      });
      if (stickyAi.action !== target.action) {
        target.action = stickyAi.action;
        target.confidence = stickyAi.confidence;
        target.aiText = [target.aiText, stickyAi.stickyNote]
          .filter(Boolean)
          .join(" · ");
        if (target.action === "wait") {
          target.entry = null;
          target.tp = null;
          target.sl = null;
        }
      }

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
  const alignmentPortfolios = portfolios.filter((p) => p.strategy !== "smc");
  const smcPortfolios = portfolios.filter((p) => p.strategy === "smc");
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
    alignmentPortfolios.length &&
    candidates.length
  ) {
    for (const pf of alignmentPortfolios) {
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
        strategy: "alignment",
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

  // --- Portefeuille(x) SMC Boriaz ---
  let smcScan: import("./smc-scan").SmcScanResult | null = null;
  if (prefs.paperTradeEnabled !== false && smcPortfolios.length) {
    try {
      const { scanSmcWatchlist } = await import("./smc-scan");
      const primary = smcPortfolios[0]!;
      smcScan = await scanSmcWatchlist({
        coins: prefs.watchCoins.slice(0, 16),
        walletEur: primary.bankrollEur,
        maxLeverage: primary.maxLeverage,
        prices: priceMap,
        force: Boolean(options?.force),
      });

      for (const pf of smcPortfolios) {
        const setup = smcScan.best;
        if (
          !setup ||
          !setup.order ||
          !setup.risk ||
          !setup.checklist.allPass ||
          !smcScan.aiApproved
        ) {
          continue;
        }
        if (setup.status === "ANNULÉ") continue;

        const acc = computePaperAccount(paperForCheck, pf.bankrollEur, pf.id);
        if (
          Number.isFinite(pf.maxLossEur) &&
          pf.maxLossEur > 0 &&
          pf.bankrollEur - acc.equityEur >= pf.maxLossEur
        ) {
          continue;
        }
        if (pf.tradesPerDay > 0) {
          const today = paperForCheck.filter(
            (t) =>
              (t.portfolioId || "default") === pf.id &&
              Date.now() - t.openedAt < 24 * 3600_000,
          ).length;
          if (today >= pf.tradesPerDay) continue;
        }

        const justification: TradeJustification = {
          summary: `SMC Boriaz ${setup.order.side.toUpperCase()} ${setup.coin} · structure OK · risque ${setup.risk.riskPct}% · gate mécanique`,
          bullets: [
            `Stratégie SMC top-down D1→H4→H1→M15`,
            `MTF ${setup.bias.d1}/${setup.bias.h4}/${setup.bias.h1}`,
            setup.liquidityLevel != null
              ? `Liquidity sweep @ ${setup.liquidityLevel}`
              : setup.checklist.liquiditySweep
                ? "Liquidity sweep validé"
                : "Sweep soft / BOS",
            setup.checklist.chochBos ? "CHoCH + BOS" : "Structure soft",
            setup.fvg
              ? `FVG ${setup.fvg.low}–${setup.fvg.high}`
              : "FVG optionnel",
            setup.ote
              ? `ÔTE ${setup.ote.low}–${setup.ote.high} (idéal ${setup.ote.ideal})`
              : "ÔTE",
            `Risque ${setup.risk.riskEur.toFixed(2)} € (2%) · notionnel ${setup.risk.notionalEur} €`,
            `TP1 1R 50%+BE · TP2 2R`,
            smcScan.aiNote || "Gate mécanique",
          ],
          alignmentScore: setup.confidence,
          aiVerified: smcScan.aiApproved,
          aiNote: smcScan.aiNote,
          portfolioId: pf.id,
          portfolioName: pf.name,
          timeframe: pf.timeframe,
          triggeredAt: Date.now(),
          smcReport: smcScan.aiReport || setup.report,
        };

        const opened = await openPaperTrade({
          openedAt: Date.now(),
          coin: setup.coin,
          side: setup.order.side,
          entry: setup.order.entry,
          tp: setup.order.tp2,
          sl: setup.order.sl,
          tp1: setup.order.tp1,
          tp2: setup.order.tp2,
          leverage: setup.risk.leverage,
          sizePct: setup.risk.sizePct,
          marginEur: setup.risk.marginEur,
          notionalEur: setup.risk.notionalEur,
          entryMode: setup.order.entryMode,
          note: justification.summary,
          bankrollEur: pf.bankrollEur,
          markPx: setup.price,
          portfolioId: pf.id,
          portfolioName: pf.name,
          justification,
          strategy: "smc",
          riskPct: 2,
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
            alignment: setup.confidence,
            reason: justification.summary,
            portfolioId: pf.id,
            portfolioName: pf.name,
            justification,
          });
          await appendJournal({
            at: Date.now(),
            coin: setup.coin,
            action: setup.order.side,
            confidence: setup.confidence,
            entry: setup.order.entry,
            tp: setup.order.tp2,
            sl: setup.order.sl,
            leverage: `${setup.risk.leverage}×`,
            sizePct: `risque 2%`,
            reason: justification.summary,
            source: `smc-boriaz:${pf.id}`,
            portfolioId: pf.id,
            justification: (smcScan.aiReport || setup.report).slice(0, 500),
          });

          if (notify && !hush) {
            const tgKey = `smc:${setup.coin}:${setup.order.side}:${Math.round(setup.order.entry)}`;
            if (tgKey !== lastTgKey || Date.now() - lastTgAt > TG_COOLDOWN) {
              const res = await sendTelegramMessage(
                [
                  `SMC BORIAZ · ${setup.order.side.toUpperCase()} ${setup.coin}`,
                  setup.status,
                  `E ${setup.order.entry} · SL ${setup.order.sl}`,
                  `TP1 ${setup.order.tp1} (50%+BE) · TP2 ${setup.order.tp2}`,
                  `Risque 2% = ${setup.risk.riskEur.toFixed(2)} €`,
                  smcScan.aiNote || "",
                  "",
                  "Simulation paper SMC — pas un conseil financier.",
                ]
                  .filter(Boolean)
                  .join("\n"),
              );
              if (res.ok) {
                telegramSent = true;
                lastTgKey = tgKey;
                lastTgAt = Date.now();
              } else telegramError = res.error ?? telegramError;
            }
          }
        }
      }
    } catch (e) {
      console.error("SMC Boriaz scan failed", e);
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
      "Suggestions éducatives (Alignement TF×crowd×Nansen×IA + SMC Boriaz). Paper = simulation. Pas un conseil financier.",
    smc: smcScan,
  };
  cache = { at: Date.now(), value };
  return value;
}
