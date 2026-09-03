import { WATCHLIST, getWatchlistSnapshot, runPriceWatch } from "./price-watch";
import { analyzeCoinFrames } from "./market-analysis";
import { computeTradeLevels } from "./levels";
import { fetchNansenSnapshot } from "./nansen";
import { detectCrowdFlows } from "./crowd-flow";
import { getWhaleDashboard } from "./dashboard";
import { sendTelegramMessage } from "./telegram";
import {
  appendJournal,
  computePaperAccount,
  inHushHours,
  loadPrefs,
  openPaperTrade,
  loadPaperTrades,
  savePaperTrades,
  type PaperAccount,
  type PaperTrade,
} from "./persist";
import type { EntryMode } from "./user-types";
import type { BuyTimingAction, SignalBias } from "./types";

export interface DirectionSignal {
  coin: string;
  action: "long" | "short" | "wait";
  confidence: number;
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
  invalidation: string;
  closeSuggestion: string | null;
}

export interface TradeSignalPayload {
  signals: DirectionSignal[];
  best: DirectionSignal | null;
  paper: PaperTrade[];
  account: PaperAccount;
  telegramSent: boolean;
  telegramError: string | null;
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
  const prompt = `Analyste crypto prudent. FR. PAS un conseil financier.
Choisis AU PLUS 1 setup LONG ou SHORT (ou WAIT) sur la watchlist.
Si action long/short, privilégie entrée AU PRIX ACTUEL si confiance ≥62, sinon limite pullback/bounce.
JSON strict:
{"action":"long"|"short"|"wait","coin":"BTC","confidence":0-100,"leverage":"2x","sizePct":"1% capital","entry":123.4,"tp":130,"sl":118,"entryMode":"market_now"|"limit_wait","reason":"...","invalidation":"...","detail":"3 phrases"}
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
    if (!hit && pnlPct <= -8) hit = "invalidated";

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
  const bankroll = prefs.paperBankrollEur || 1000;

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
  const signals: DirectionSignal[] = [];

  for (const { coin } of watch) {
    const frames = await analyzeCoinFrames(coin, [
      { interval: "4h", horizon: "moyen" },
    ]);
    const main = frames[0];
    if (!main) continue;
    const quote = quotes.quotes.find((q) => q.coin === coin);
    const crowdHit = crowd.find((c) => c.coin === coin);
    let action: "long" | "short" | "wait" = "wait";
    let confidence = 40;

    if (crowdHit?.side === "short" && main.score <= 1) {
      action = "short";
      confidence = Math.min(
        85,
        52 + crowdHit.qualityWhaleCount * 6 + Math.abs(Math.min(main.score, 0)) * 4,
      );
    } else if (crowdHit?.side === "long" && main.score >= -1) {
      action = "long";
      confidence = Math.min(
        85,
        52 + crowdHit.qualityWhaleCount * 6 + Math.max(main.score, 0) * 4,
      );
    } else if (
      main.buyTiming.action === "acheter_zone" &&
      main.bias !== "baissier"
    ) {
      action = "long";
      confidence = Math.min(72, main.buyTiming.confidence);
    } else if (main.bias === "baissier" && main.score <= -3) {
      action = "short";
      confidence = Math.min(70, 48 + Math.abs(main.score) * 5);
    }

    const nansenShort = nansen.recentPerpTrades.filter(
      (t) =>
        t.symbol.toUpperCase() === coin &&
        t.side.toLowerCase().includes("short"),
    ).length;
    const nansenLong = nansen.recentPerpTrades.filter(
      (t) =>
        t.symbol.toUpperCase() === coin && t.side.toLowerCase().includes("long"),
    ).length;
    if (nansenShort >= 3 && action === "short") confidence += 5;
    if (nansenLong >= 3 && action === "long") confidence += 5;

    const price = quote?.price ?? main.indicators.price;
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

    signals.push({
      coin,
      action,
      confidence: Math.min(90, confidence),
      leverage: leverageFor(
        confidence,
        main.indicators.adx14,
        prefs.maxLeverage,
      ),
      sizePct: sizeFor(confidence),
      spotPhase: spotPhaseFrom(main.buyTiming.action, main.bias),
      bias: main.bias,
      price,
      entry,
      idealEntry,
      tp,
      sl,
      entryMode,
      entryHint,
      riskReward,
      reason: crowdHit ? `${crowdHit.summary} · ${main.summary}` : main.summary,
      aiText: null,
      invalidation: main.buyZone.summary,
      closeSuggestion,
    });
  }

  const compact = signals.map((s) => ({
    coin: s.coin,
    actionRule: s.action,
    confidence: s.confidence,
    bias: s.bias,
    price: s.price,
    entry: s.entry,
    idealEntry: s.idealEntry,
    entryMode: s.entryMode,
    tp: s.tp,
    sl: s.sl,
    reason: s.reason.slice(0, 140),
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
    [...signals].sort((a, b) => b.confidence - a.confidence)[0] ?? null;

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
      target.reason = ai.reason || target.reason;
      target.invalidation = ai.invalidation || target.invalidation;
      if (ai.entryMode) target.entryMode = ai.entryMode;
      if (ai.entry && ai.entry > 0) target.entry = ai.entry;
      if (ai.tp && ai.tp > 0) target.tp = ai.tp;
      if (ai.sl && ai.sl > 0) target.sl = ai.sl;

      // Recalcule cohérent si manquant
      if (target.action === "long" || target.action === "short") {
        const lv = computeTradeLevels(
          target.action,
          target.price,
          {
            price: target.price,
            change24hPct: null,
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

        // Si IA dit market mais entry loin du prix → ramener au spot
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
    best.action = "wait";
    best.aiText = ai.detail || "IA : patienter.";
    best.confidence = Math.min(best.confidence, ai.confidence || 40);
    best.entry = null;
    best.idealEntry = null;
    best.tp = null;
    best.sl = null;
    best.entryMode = null;
    best.entryHint = "Pas d’entrée — attendre un meilleur setup.";
  }

  let telegramSent = false;
  let telegramError: string | null = null;
  const notify = options?.notify !== false && prefs.telegramEnabled;
  const hush = inHushHours(prefs);

  if (notify && !hush) {
    for (const c of closes.slice(0, 2)) {
      const res = await sendTelegramMessage(
        [
          `PAPER ${c.status.toUpperCase()} · ${c.side.toUpperCase()} ${c.coin}`,
          `Entrée ${c.entry} → sortie ${c.exitPx ?? "—"}`,
          `PnL ${c.pnlEur?.toFixed(2) ?? "0"} € (${c.pnlPct?.toFixed(2)} %)`,
          `Solde paper de départ ${bankroll} €`,
          c.note,
          "Pas un conseil financier.",
        ].join("\n"),
      );
      if (res.ok) telegramSent = true;
      else telegramError = res.error ?? telegramError;
    }
  }

  if (
    notify &&
    !hush &&
    best &&
    best.action !== "wait" &&
    best.confidence >= 62 &&
    best.entry &&
    best.tp &&
    best.sl
  ) {
    const key = `${best.coin}:${best.action}:${Math.round(best.entry)}:${Math.round(best.confidence / 5)}:${best.entryMode}`;
    if (key !== lastTgKey || Date.now() - lastTgAt > TG_COOLDOWN) {
      const text = [
        `SIGNAL ${best.action.toUpperCase()} · ${best.coin}`,
        `Mode: ${best.entryMode === "limit_wait" ? "LIMITE (attendre le prix)" : "MARCHÉ (entrer maintenant)"}`,
        `Confiance ${best.confidence}/100`,
        `Entrée ~ ${best.entry}`,
        best.idealEntry ? `Idéal limite ~ ${best.idealEntry}` : "",
        `TP ~ ${best.tp}`,
        `SL ~ ${best.sl}`,
        `Levier: ${best.leverage}`,
        `Mise: ${best.sizePct}`,
        `Prix spot ~ ${best.price}`,
        best.entryHint || "",
        best.reason,
        best.aiText ? `IA: ${best.aiText}` : "",
        `Invalidation: ${best.invalidation}`,
        "",
        "Pas un conseil financier. Risque de perte totale possible.",
      ]
        .filter(Boolean)
        .join("\n");
      const res = await sendTelegramMessage(text);
      telegramSent = res.ok || telegramSent;
      telegramError = res.error ?? telegramError;
      if (res.ok) {
        lastTgKey = key;
        lastTgAt = Date.now();
        await appendJournal({
          at: Date.now(),
          coin: best.coin,
          action: best.action,
          confidence: best.confidence,
          entry: best.entry,
          tp: best.tp,
          sl: best.sl,
          leverage: best.leverage,
          sizePct: best.sizePct,
          reason: best.aiText || best.reason,
          source: "trade-signal",
        });
        if (prefs.paperTradeEnabled) {
          const levNum = Number(
            String(best.leverage).match(/[\d.]+/)?.[0] || 1,
          );
          const sizeNum = Number(
            String(best.sizePct).match(/[\d.]+/)?.[0] || 1,
          );
          await openPaperTrade({
            openedAt: Date.now(),
            coin: best.coin,
            side: best.action,
            entry: best.entry,
            tp: best.tp,
            sl: best.sl,
            leverage: levNum,
            sizePct: sizeNum,
            entryMode: best.entryMode ?? "market_now",
            note: "Ouvert auto depuis signal",
            bankrollEur: bankroll,
            markPx: best.price,
          });
        }
      }
    }
  }

  const paperLatest = await loadPaperTrades();
  const account = computePaperAccount(paperLatest, bankroll);

  const value: TradeSignalPayload = {
    signals: signals.sort((a, b) => b.confidence - a.confidence),
    best,
    paper: paperLatest.slice(0, 40),
    account,
    telegramSent,
    telegramError,
    fetchedAt: Date.now(),
    disclaimer:
      "Suggestions éducatives (règles + IA + wallets). Paper = simulation 1000 €. Pas un conseil financier.",
  };
  cache = { at: Date.now(), value };
  return value;
}
