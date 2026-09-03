import { WATCHLIST, getWatchlistSnapshot, runPriceWatch } from "./price-watch";
import { analyzeCoinFrames } from "./market-analysis";
import { fetchNansenSnapshot } from "./nansen";
import { detectCrowdFlows } from "./crowd-flow";
import { getWhaleDashboard } from "./dashboard";
import { sendTelegramMessage } from "./telegram";
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
  reason: string;
  aiText: string | null;
  invalidation: string;
}

export interface TradeSignalPayload {
  signals: DirectionSignal[];
  best: DirectionSignal | null;
  telegramSent: boolean;
  telegramError: string | null;
  fetchedAt: number;
  disclaimer: string;
}

const CACHE_TTL = 20 * 60_000;
const AI_TTL = 45 * 60_000;
let cache: { at: number; value: TradeSignalPayload } | null = null;
let lastTgKey = "";
let lastTgAt = 0;

function leverageFor(confidence: number, adx: number | null): string {
  if (confidence >= 75 && (adx ?? 0) >= 25) return "2–3× max";
  if (confidence >= 60) return "1.5–2×";
  return "1× (spot ou levier minimal)";
}

function sizeFor(confidence: number): string {
  if (confidence >= 75) return "1.5–2.5 % du capital";
  if (confidence >= 60) return "0.75–1.5 % du capital";
  return "0–0.5 % (passer / réduire)";
}

function spotPhaseFrom(action: BuyTimingAction, bias: SignalBias): "achat" | "vente" | "neutre" {
  if (action === "acheter_zone" || action === "surveiller_achat") return "achat";
  if (action === "eviter" || bias === "baissier") return "vente";
  return "neutre";
}

async function askSignalAi(compact: unknown[]): Promise<string | null> {
  const prompt = `Tu es un analyste crypto prudent. FR. PAS un conseil financier garanti.
À partir des données (indicateurs + crowd HL + Nansen), choisis AU PLUS 1 setup prioritaire LONG ou SHORT parmi la watchlist, ou WAIT.
Réponds STRICTEMENT en JSON:
{"action":"long"|"short"|"wait","coin":"BTC","confidence":0-100,"leverage":"1-2x","sizePct":"1% capital","reason":"...","invalidation":"...","detail":"3 phrases max"}
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
          max_tokens: 400,
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
      // fall through
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
        max_tokens: 400,
        messages: [
          { role: "system", content: "Réponds uniquement en JSON valide." },
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

function parseAiJson(text: string | null): {
  action: "long" | "short" | "wait";
  coin: string;
  confidence: number;
  leverage: string;
  sizePct: string;
  reason: string;
  invalidation: string;
  detail: string;
} | null {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as Record<string, unknown>;
    const action = String(obj.action || "wait").toLowerCase();
    if (action !== "long" && action !== "short" && action !== "wait") return null;
    return {
      action,
      coin: String(obj.coin || "").toUpperCase(),
      confidence: Number(obj.confidence ?? 0),
      leverage: String(obj.leverage || "1x"),
      sizePct: String(obj.sizePct || "≤1%"),
      reason: String(obj.reason || ""),
      invalidation: String(obj.invalidation || ""),
      detail: String(obj.detail || obj.reason || ""),
    };
  } catch {
    return null;
  }
}

export async function getTradeSignals(options?: {
  notify?: boolean;
  force?: boolean;
}): Promise<TradeSignalPayload> {
  if (!options?.force && cache && Date.now() - cache.at < CACHE_TTL) {
    return cache.value;
  }

  try {
    await runPriceWatch();
  } catch {
    // ignore
  }

  const [quotes, nansen, dashboard] = await Promise.all([
    getWatchlistSnapshot(),
    fetchNansenSnapshot(),
    getWhaleDashboard().catch(() => null),
  ]);

  const crowd = dashboard ? detectCrowdFlows(dashboard.whales) : [];
  const signals: DirectionSignal[] = [];

  for (const { coin } of WATCHLIST) {
    const frames = await analyzeCoinFrames(coin, [
      { interval: "4h", horizon: "moyen" },
    ]);
    const main = frames[0];
    if (!main) continue;
    const quote = quotes.quotes.find((q) => q.coin === coin);
    const crowdHit = crowd.find((c) => c.coin === coin);
    let action: "long" | "short" | "wait" = "wait";
    let confidence = 40;

    if (crowdHit?.side === "short" && main.score <= 0) {
      action = "short";
      confidence = Math.min(82, 50 + crowdHit.qualityWhaleCount * 6 + Math.abs(main.score) * 3);
    } else if (crowdHit?.side === "long" && main.score >= 0) {
      action = "long";
      confidence = Math.min(82, 50 + crowdHit.qualityWhaleCount * 6 + main.score * 3);
    } else if (main.buyTiming.action === "acheter_zone" && main.bias !== "baissier") {
      action = "long";
      confidence = Math.min(70, main.buyTiming.confidence);
    } else if (main.bias === "baissier" && main.score <= -3) {
      action = "short";
      confidence = Math.min(68, 45 + Math.abs(main.score) * 5);
    }

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
    if (nansenShort >= 3 && action === "short") confidence += 5;
    if (nansenLong >= 3 && action === "long") confidence += 5;

    signals.push({
      coin,
      action,
      confidence: Math.min(90, confidence),
      leverage: leverageFor(confidence, main.indicators.adx14),
      sizePct: sizeFor(confidence),
      spotPhase: spotPhaseFrom(main.buyTiming.action, main.bias),
      bias: main.bias,
      price: quote?.price ?? main.indicators.price,
      reason: crowdHit
        ? `${crowdHit.summary} · ${main.summary}`
        : main.summary,
      aiText: null,
      invalidation: main.buyZone.summary,
    });
  }

  const compact = signals.map((s) => ({
    coin: s.coin,
    actionRule: s.action,
    confidence: s.confidence,
    bias: s.bias,
    price: s.price,
    spotPhase: s.spotPhase,
    reason: s.reason.slice(0, 160),
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
      target.confidence = Math.max(target.confidence, ai.confidence || target.confidence);
      target.leverage = ai.leverage || target.leverage;
      target.sizePct = ai.sizePct || target.sizePct;
      target.aiText = ai.detail || ai.reason;
      target.reason = ai.reason || target.reason;
      target.invalidation = ai.invalidation || target.invalidation;
      best = target;
    }
  } else if (ai?.action === "wait" && best) {
    best.action = "wait";
    best.aiText = ai.detail || "IA : patienter.";
    best.confidence = Math.min(best.confidence, ai.confidence || 40);
  }

  for (const s of signals) {
    if (!s.aiText && ai?.detail && ai.coin === s.coin) s.aiText = ai.detail;
  }

  let telegramSent = false;
  let telegramError: string | null = null;
  const notify = options?.notify !== false;
  if (
    notify &&
    best &&
    best.action !== "wait" &&
    best.confidence >= 65 &&
    best.aiText
  ) {
    const key = `${best.coin}:${best.action}:${Math.round(best.confidence / 5)}`;
    if (key !== lastTgKey || Date.now() - lastTgAt > AI_TTL) {
      const text = [
        `SIGNAL ${best.action.toUpperCase()} · ${best.coin}`,
        `Confiance ${best.confidence}/100`,
        `Levier suggéré: ${best.leverage}`,
        `Mise suggérée: ${best.sizePct}`,
        `Prix ~ ${best.price}`,
        best.reason,
        best.aiText ? `IA: ${best.aiText}` : "",
        `Invalidation: ${best.invalidation}`,
        "",
        "Pas un conseil financier. Risque de perte totale possible.",
      ]
        .filter(Boolean)
        .join("\n");
      const res = await sendTelegramMessage(text);
      telegramSent = res.ok;
      telegramError = res.error ?? null;
      if (res.ok) {
        lastTgKey = key;
        lastTgAt = Date.now();
      }
    }
  }

  const value: TradeSignalPayload = {
    signals: signals.sort((a, b) => b.confidence - a.confidence),
    best,
    telegramSent,
    telegramError,
    fetchedAt: Date.now(),
    disclaimer:
      "Suggestions éducatives (règles + IA). Pas un conseil financier. Dimensionne toujours selon ton risque.",
  };
  cache = { at: Date.now(), value };
  return value;
}
