import { analyzeCoinFrames } from "./market-analysis";
import { computeTradeLevels } from "./levels";
import { loadPaperTrades, loadPrefs, savePaperTrades } from "./persist";
import { sendTelegramMessage } from "./telegram";
import { estimateRoundTripFeesEur, type PaperTrade } from "./user-types";
import type { SignalBias, TimeframeFrame } from "./types";

export type ManageAction = "close" | "flip" | "wait" | "hold";

export interface ManageDecision {
  id: string;
  coin: string;
  side: "long" | "short";
  action: ManageAction;
  reason: string;
  price: number;
  pnlEur: number | null;
  providers: string[];
}

export interface ManageResult {
  reviewed: number;
  decisions: ManageDecision[];
  telegramSent: boolean;
  aiUsed: boolean;
}

function sideFromBias(bias: SignalBias, score: number): "long" | "short" | "wait" {
  if (bias === "haussier" || score >= 3) return "long";
  if (bias === "baissier" || score <= -3) return "short";
  return "wait";
}

/**
 * Décision déterministe (sans IA) : gère le cas « zone majeure avec
 * résistance/support » → prendre le TP, et les vrais retournements → flip.
 */
function deterministicDecision(
  trade: PaperTrade,
  frames: TimeframeFrame[],
): { action: ManageAction; reason: string; price: number } {
  const f1h = frames.find((f) => f.interval === "1h") ?? frames[0];
  const f4h = frames.find((f) => f.interval === "4h") ?? f1h;
  const ind = f1h?.indicators;
  const price = ind?.price ?? trade.markPx ?? trade.entry;
  if (!ind) return { action: "hold", reason: "Données TF indisponibles", price };

  const s1h = sideFromBias(f1h.bias, f1h.score);
  const s4h = sideFromBias(f4h.bias, f4h.score);
  const inProfit =
    trade.side === "long" ? price > trade.entry : price < trade.entry;

  if (trade.side === "long") {
    const res = [ind.resistance, ind.bbUpper]
      .filter((v): v is number => v != null && v > 0 && v >= price)
      .sort((a, b) => a - b)[0];
    const nearRes = res != null && (res - price) / price <= 0.006; // ≤0.6 %
    if (nearRes && inProfit) {
      const bearishTurn = s1h === "short";
      return {
        action: bearishTurn ? "flip" : "close",
        reason: bearishTurn
          ? `Zone majeure ~${res?.toFixed(4)} + 1h qui retourne → TP puis SHORT`
          : `Résistance majeure ~${res?.toFixed(4)} atteinte → prendre le TP`,
        price,
      };
    }
    if (s1h === "short" && s4h === "short") {
      return { action: "flip", reason: "1h+4h retournés baissiers → basculer SHORT", price };
    }
    if (s1h === "short") {
      return { action: "wait", reason: "1h baissier mais 4h pas confirmé → attendre confirmation", price };
    }
    return { action: "hold", reason: "Tendance encore favorable → laisser courir", price };
  }

  // SHORT
  const sup = [ind.support, ind.bbLower]
    .filter((v): v is number => v != null && v > 0 && v <= price)
    .sort((a, b) => b - a)[0];
  const nearSup = sup != null && (price - sup) / price <= 0.006;
  if (nearSup && inProfit) {
    const bullishTurn = s1h === "long";
    return {
      action: bullishTurn ? "flip" : "close",
      reason: bullishTurn
        ? `Support majeur ~${sup?.toFixed(4)} + 1h qui retourne → TP puis LONG`
        : `Support majeur ~${sup?.toFixed(4)} atteint → prendre le TP`,
      price,
    };
  }
  if (s1h === "long" && s4h === "long") {
    return { action: "flip", reason: "1h+4h retournés haussiers → basculer LONG", price };
  }
  if (s1h === "long") {
    return { action: "wait", reason: "1h haussier mais 4h pas confirmé → attendre confirmation", price };
  }
  return { action: "hold", reason: "Tendance encore favorable → laisser courir", price };
}

function parseAiAction(text: string | null): { action: ManageAction; reason: string } | null {
  if (!text) return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as Record<string, unknown>;
    const raw = String(o.action || "").toLowerCase();
    const action: ManageAction =
      raw.includes("flip") || raw.includes("short") || raw.includes("bascul")
        ? "flip"
        : raw.includes("close") || raw.includes("ferm") || raw.includes("tp")
          ? "close"
          : raw.includes("wait") || raw.includes("attend") || raw.includes("confirm")
            ? "wait"
            : "hold";
    return { action, reason: String(o.reason || o.detail || "").slice(0, 200) };
  } catch {
    return null;
  }
}

async function askProvider(
  provider: "anthropic" | "openai",
  prompt: string,
): Promise<string | null> {
  try {
    if (provider === "anthropic") {
      const key = process.env.ANTHROPIC_API_KEY?.trim();
      if (!key) return null;
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL?.trim() || "claude-haiku-4-5-20251001",
          max_tokens: 200,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const j = (await res.json()) as { content?: { type: string; text?: string }[] };
      return res.ok ? j.content?.find((c) => c.type === "text")?.text?.trim() ?? null : null;
    }
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key) return null;
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
        temperature: 0.1,
        max_tokens: 200,
        messages: [
          { role: "system", content: "JSON uniquement." },
          { role: "user", content: prompt },
        ],
      }),
    });
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return j.choices?.[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  }
}

/** Les 2 IA relisent le trade et votent. Consensus requis pour agir sur leur avis. */
async function aiDecision(
  trade: PaperTrade,
  frames: TimeframeFrame[],
  price: number,
): Promise<{ action: ManageAction; reason: string; providers: string[] } | null> {
  const ind = (frames.find((f) => f.interval === "1h") ?? frames[0])?.indicators;
  const ctx = {
    coin: trade.coin,
    side: trade.side,
    entry: trade.entry,
    price,
    tp: trade.tp,
    sl: trade.sl,
    pnlPct: trade.pnlPct,
    tf: frames.map((f) => ({ i: f.interval, bias: f.bias, score: f.score })),
    rsi1h: ind?.rsi14 ?? null,
    resistance: ind?.resistance ?? null,
    support: ind?.support ?? null,
    ema200: ind?.ema200 ?? null,
  };
  const prompt = `Tu gères un trade paper ouvert. FR. PAS un conseil financier.
Décide UNE action sur CE trade selon multi-TF + niveaux :
- "close" : prendre le TP / sortir (ex. résistance majeure atteinte).
- "flip" : sortir ET basculer dans le sens inverse (retournement confirmé).
- "wait" : garder mais attendre une confirmation de niveau.
- "hold" : laisser courir.
JSON strict: {"action":"close|flip|wait|hold","reason":"1 phrase"}
Trade: ${JSON.stringify(ctx)}`;

  const opinions: { provider: string; action: ManageAction; reason: string }[] = [];
  for (const p of ["anthropic", "openai"] as const) {
    const txt = await askProvider(p, prompt);
    const parsed = parseAiAction(txt);
    if (parsed) opinions.push({ provider: p, ...parsed });
  }
  if (!opinions.length) return null;
  const providers = opinions.map((o) => o.provider);
  // Consensus : si les avis divergent, on retourne null (repli déterministe).
  const uniq = new Set(opinions.map((o) => o.action));
  if (uniq.size === 1) {
    return { action: opinions[0].action, reason: opinions.map((o) => `${o.provider}: ${o.reason}`).join(" · "), providers };
  }
  // Un seul avis dispo → on l'utilise ; sinon divergence → null.
  if (opinions.length === 1) {
    return { action: opinions[0].action, reason: `${opinions[0].provider}: ${opinions[0].reason}`, providers };
  }
  return null;
}

/**
 * Relit chaque trade ouvert (scope courant) et applique la décision :
 * fermer, basculer (flip), attendre confirmation, ou laisser.
 */
export async function manageOpenTrades(opts?: {
  notify?: boolean;
  max?: number;
}): Promise<ManageResult> {
  const prefs = await loadPrefs();
  const notify = opts?.notify !== false && prefs.telegramEnabled;
  // Un seul load / un seul save : on mute la liste en mémoire → pas de
  // lost-update entre plusieurs écritures concurrentes.
  const list = await loadPaperTrades();
  const open = list
    .filter((t) => t.status === "open")
    .slice(0, opts?.max ?? 12);
  const decisions: ManageDecision[] = [];
  const notes: string[] = [];
  let aiUsed = false;

  for (const trade of open) {
    let frames: TimeframeFrame[] = [];
    try {
      frames = await analyzeCoinFrames(trade.coin, [
        { interval: "1h", horizon: "court (1h)" },
        { interval: "4h", horizon: "moyen (4h)" },
        { interval: "1d", horizon: "long (1d)" },
      ]);
    } catch {
      frames = [];
    }
    if (!frames.length) continue;

    const det = deterministicDecision(trade, frames);
    const ai = await aiDecision(trade, frames, det.price);
    if (ai) aiUsed = true;
    const action = ai?.action ?? det.action;
    const reason = ai ? ai.reason : det.reason;
    const providers = ai?.providers ?? ["règles"];
    const price = det.price;

    decisions.push({
      id: trade.id,
      coin: trade.coin,
      side: trade.side,
      action,
      reason,
      price,
      pnlEur: trade.pnlEur ?? null,
      providers,
    });

    if (action === "close" || action === "flip") {
      const movePct =
        trade.side === "long"
          ? ((price - trade.entry) / trade.entry) * 100
          : ((trade.entry - price) / trade.entry) * 100;
      const pnlPct = movePct * trade.leverage;
      const netEur = trade.marginEur * (pnlPct / 100) - (trade.feesEur ?? 0);
      trade.status = "closed_manual";
      trade.closedAt = Date.now();
      trade.exitPx = price;
      trade.markPx = price;
      trade.pnlPct = pnlPct;
      trade.pnlEur = netEur;
      trade.closeNotified = true;
      trade.note = `${action === "flip" ? "IA: bascule" : "IA: clôture"} @ ${price} — net ${netEur.toFixed(2)} € · ${reason}`.slice(0, 220);
      if (notify) {
        notes.push(
          [
            `${action === "flip" ? "🔄 Bascule" : "🤖 Clôture IA"} · ${trade.side.toUpperCase()} ${trade.coin}`,
            `Portefeuille « ${trade.portfolioName || "Défaut"} »`,
            `Sortie ~${price} · PnL net ${netEur >= 0 ? "+" : ""}${netEur.toFixed(2)} €`,
            reason,
            "Simulation paper — pas un conseil financier.",
          ].join("\n"),
        );
      }

      if (action === "flip") {
        const oppSide = trade.side === "long" ? "short" : "long";
        const ind = (frames.find((f) => f.interval === "1h") ?? frames[0])
          .indicators;
        const lv = computeTradeLevels(oppSide, price, ind, 66);
        const notionalEur = trade.marginEur * trade.leverage;
        const now = Date.now();
        // Évite un doublon si une position opposée est déjà ouverte.
        const dup = list.some(
          (t) =>
            (t.status === "open" || t.status === "pending") &&
            t.coin === trade.coin &&
            t.side === oppSide &&
            (t.portfolioId || "default") === (trade.portfolioId || "default"),
        );
        if (!dup) {
          const flipTrade: PaperTrade = {
            id: `pt-${now}-${trade.portfolioId || "default"}-${trade.coin}-${oppSide}`,
            closeNotified: false,
            feesEur: estimateRoundTripFeesEur(notionalEur),
            openedAt: now,
            filledAt: now,
            coin: trade.coin,
            side: oppSide,
            entry: price,
            tp: lv.tp,
            sl: lv.sl,
            leverage: trade.leverage,
            sizePct: trade.sizePct,
            marginEur: trade.marginEur,
            notionalEur,
            entryMode: "market_now",
            status: "open",
            closedAt: null,
            exitPx: null,
            markPx: price,
            pnlPct: 0,
            pnlEur: 0,
            note: `Bascule IA depuis ${trade.side.toUpperCase()} · ${reason}`.slice(0, 220),
            portfolioId: trade.portfolioId || "default",
            portfolioName: trade.portfolioName || "Défaut (sûr)",
            justification: null,
          };
          list.unshift(flipTrade);
          if (notify) {
            notes.push(
              [
                `🆕 Ouverture ${oppSide.toUpperCase()} ${trade.coin} (bascule)`,
                `Entrée ~${price} · TP ${lv.tp.toFixed(4)} · SL ${lv.sl.toFixed(4)}`,
                "Simulation paper — pas un conseil financier.",
              ].join("\n"),
            );
          }
        }
      }
    } else {
      trade.note = `${action === "wait" ? "IA: attendre confirmation" : "IA: laisser courir"} · ${reason}`.slice(0, 220);
    }
  }

  await savePaperTrades(list);

  let telegramSent = false;
  for (const text of notes.slice(0, 10)) {
    const r = await sendTelegramMessage(text);
    telegramSent = telegramSent || r.ok;
  }

  return { reviewed: open.length, decisions, telegramSent, aiUsed };
}
