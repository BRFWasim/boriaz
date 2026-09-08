import { analyzeCoinFrames } from "./market-analysis";
import { computeTradeLevels } from "./levels";
import { postInfo } from "./hyperliquid";
import { parseNum } from "./format";
import { loadPaperTrades, loadPrefs, savePaperTrades } from "./persist";
import { sendTelegramMessage } from "./telegram";
import {
  estimateRoundTripFeesEur,
  type PaperTrade,
  type TradeManageSnapshot,
} from "./user-types";
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
  outlook?: string;
}

export interface ManageResult {
  reviewed: number;
  decisions: ManageDecision[];
  telegramSent: boolean;
  aiUsed: boolean;
  trades?: PaperTrade[];
}

function sideFromBias(bias: SignalBias, score: number): "long" | "short" | "wait" {
  if (bias === "haussier" || score >= 3) return "long";
  if (bias === "baissier" || score <= -3) return "short";
  return "wait";
}

function livePnl(
  trade: PaperTrade,
  price: number,
): { pnlPct: number; pnlEur: number; movePct: number } {
  const movePct =
    trade.side === "long"
      ? ((price - trade.entry) / trade.entry) * 100
      : ((trade.entry - price) / trade.entry) * 100;
  const qtyPct = trade.remainingQtyPct ?? 1;
  const pnlPct = movePct * trade.leverage;
  const unrealizedEur = trade.marginEur * (pnlPct / 100) * qtyPct;
  const feesShare = (trade.feesEur ?? 0) * qtyPct;
  const pnlEur =
    unrealizedEur - feesShare + (trade.realizedPartialEur ?? 0);
  return { pnlPct, pnlEur, movePct };
}

function distPct(a: number, b: number): number {
  if (!(a > 0) || !(b > 0)) return 999;
  return Math.abs(a - b) / a;
}

/**
 * Décision déterministe enrichie : PnL live + structure + zones S/R.
 * - close : setup mort / zone majeure atteinte en profit / adverse fort + perte
 * - hold : rebond/rechute favorable encore probable
 * - wait : signal mixte
 * - flip : retournement 1h+4h confirmé
 */
function deterministicDecision(
  trade: PaperTrade,
  frames: TimeframeFrame[],
  price: number,
  pnl: { pnlPct: number; pnlEur: number; movePct: number },
): { action: ManageAction; reason: string; outlook: string } {
  const f1h = frames.find((f) => f.interval === "1h") ?? frames[0];
  const f4h = frames.find((f) => f.interval === "4h") ?? f1h;
  const ind = f1h?.indicators;
  if (!ind) {
    return {
      action: "hold",
      reason: "Données TF indisponibles",
      outlook: "Pas assez de data — on garde en surveillance.",
    };
  }

  const s1h = sideFromBias(f1h.bias, f1h.score);
  const s4h = sideFromBias(f4h.bias, f4h.score);
  const withTrend =
    (trade.side === "long" && s1h !== "short") ||
    (trade.side === "short" && s1h !== "long");
  const againstBoth = s1h !== "wait" && s4h !== "wait" && s1h === s4h &&
    ((trade.side === "long" && s1h === "short") ||
      (trade.side === "short" && s1h === "long"));

  const toSl = distPct(price, trade.sl);
  const toTp = distPct(price, trade.tp);
  const nearSl = toSl <= 0.004; // ≤0.4%
  const nearTp = toTp <= 0.005;

  if (trade.side === "long") {
    const res = [ind.resistance, ind.bbUpper]
      .filter((v): v is number => v != null && v > 0 && v >= price)
      .sort((a, b) => a - b)[0];
    const sup = [ind.support, ind.bbLower]
      .filter((v): v is number => v != null && v > 0 && v <= price)
      .sort((a, b) => b - a)[0];
    const nearRes = res != null && (res - price) / price <= 0.006;
    const bounceLikely =
      sup != null &&
      (price - sup) / price <= 0.008 &&
      s1h !== "short" &&
      pnl.pnlPct > -4;

    if (nearTp && pnl.pnlEur >= 0) {
      return {
        action: "close",
        reason: `Proche TP ${trade.tp} · PnL ${pnl.pnlEur.toFixed(2)} € → sécuriser`,
        outlook: "Objectif presque touché — mieux vaut encaisser.",
      };
    }
    if (nearRes && pnl.pnlEur > 0) {
      const bearishTurn = s1h === "short";
      return {
        action: bearishTurn ? "flip" : "close",
        reason: bearishTurn
          ? `Résistance ~${res?.toFixed(4)} + 1h baissier · PnL +${pnl.pnlEur.toFixed(2)} € → TP puis SHORT`
          : `Résistance majeure ~${res?.toFixed(4)} · PnL +${pnl.pnlEur.toFixed(2)} € → prendre profits`,
        outlook: bearishTurn
          ? "Rejet en vue sous résistance — bascule short envisageable."
          : "Zone de supply — risque de rechute, on sécurise le long.",
      };
    }
    if (againstBoth && pnl.pnlPct <= -1.5) {
      return {
        action: "close",
        reason: `1h+4h baissiers + PnL ${pnl.pnlEur.toFixed(2)} € → trade long plus viable`,
        outlook: "Structure contre le long — mieux vaut couper avant le SL.",
      };
    }
    if (againstBoth && pnl.pnlPct > 1) {
      return {
        action: "flip",
        reason: "1h+4h baissiers confirmés alors que long encore vert → basculer SHORT",
        outlook: "Retournement baissier confirmé multi-TF.",
      };
    }
    if (nearSl && againstBoth) {
      return {
        action: "close",
        reason: `Proche SL + structure baissière · PnL ${pnl.pnlEur.toFixed(2)} € → couper`,
        outlook: "Peu de chance de rebond — éviter le SL plein.",
      };
    }
    if (bounceLikely && pnl.pnlPct < 0) {
      return {
        action: "hold",
        reason: `Support ~${sup?.toFixed(4)} proche · rebond long encore probable (PnL ${pnl.pnlEur.toFixed(2)} €)`,
        outlook: "Rebond possible sur support — on laisse une chance au long.",
      };
    }
    if (s1h === "short" && s4h !== "short") {
      return {
        action: "wait",
        reason: `1h baissier, 4h pas confirmé · PnL ${pnl.pnlEur.toFixed(2)} € → attendre`,
        outlook: "Pression court terme — on surveille un rejet ou un rebond.",
      };
    }
    if (withTrend) {
      return {
        action: "hold",
        reason: `Tendance encore OK · spot ${price} · PnL ${pnl.pnlEur >= 0 ? "+" : ""}${pnl.pnlEur.toFixed(2)} €`,
        outlook:
          pnl.pnlEur >= 0
            ? "Momentum favorable — laisser courir vers le TP."
            : "Pullback dans la tendance — pas encore de signal de sortie.",
      };
    }
    return {
      action: "wait",
      reason: `Signal mixte · PnL ${pnl.pnlEur.toFixed(2)} €`,
      outlook: "Lecture partagée — pas de clôture forcée pour l’instant.",
    };
  }

  // SHORT
  const sup = [ind.support, ind.bbLower]
    .filter((v): v is number => v != null && v > 0 && v <= price)
    .sort((a, b) => b - a)[0];
  const res = [ind.resistance, ind.bbUpper]
    .filter((v): v is number => v != null && v > 0 && v >= price)
    .sort((a, b) => a - b)[0];
  const nearSup = sup != null && (price - sup) / price <= 0.006;
  const dropLikely =
    res != null &&
    (res - price) / price <= 0.008 &&
    s1h !== "long" &&
    pnl.pnlPct > -4;

  if (nearTp && pnl.pnlEur >= 0) {
    return {
      action: "close",
      reason: `Proche TP ${trade.tp} · PnL ${pnl.pnlEur.toFixed(2)} € → sécuriser`,
      outlook: "Objectif short presque touché — encaisser.",
    };
  }
  if (nearSup && pnl.pnlEur > 0) {
    const bullishTurn = s1h === "long";
    return {
      action: bullishTurn ? "flip" : "close",
      reason: bullishTurn
        ? `Support ~${sup?.toFixed(4)} + 1h haussier · PnL +${pnl.pnlEur.toFixed(2)} € → TP puis LONG`
        : `Support majeur ~${sup?.toFixed(4)} · PnL +${pnl.pnlEur.toFixed(2)} € → prendre profits`,
      outlook: bullishTurn
        ? "Rebond sur support — bascule long envisageable."
        : "Zone de demande — risque de rebond, on sécurise le short.",
    };
  }
  if (againstBoth && pnl.pnlPct <= -1.5) {
    return {
      action: "close",
      reason: `1h+4h haussiers + PnL ${pnl.pnlEur.toFixed(2)} € → short plus viable`,
      outlook: "Structure contre le short — couper avant le SL.",
    };
  }
  if (againstBoth && pnl.pnlPct > 1) {
    return {
      action: "flip",
      reason: "1h+4h haussiers confirmés alors que short encore vert → basculer LONG",
      outlook: "Retournement haussier confirmé multi-TF.",
    };
  }
  if (nearSl && againstBoth) {
    return {
      action: "close",
      reason: `Proche SL + structure haussière · PnL ${pnl.pnlEur.toFixed(2)} € → couper`,
      outlook: "Squeeze haussier probable — éviter le SL plein.",
    };
  }
  if (dropLikely && pnl.pnlPct < 0) {
    return {
      action: "hold",
      reason: `Résistance ~${res?.toFixed(4)} proche · rechute short encore probable (PnL ${pnl.pnlEur.toFixed(2)} €)`,
      outlook: "Rejet possible sous résistance — on laisse une chance au short.",
    };
  }
  if (s1h === "long" && s4h !== "long") {
    return {
      action: "wait",
      reason: `1h haussier, 4h pas confirmé · PnL ${pnl.pnlEur.toFixed(2)} € → attendre`,
      outlook: "Pression acheteuse court terme — on surveille.",
    };
  }
  if (withTrend) {
    return {
      action: "hold",
      reason: `Tendance encore OK · spot ${price} · PnL ${pnl.pnlEur >= 0 ? "+" : ""}${pnl.pnlEur.toFixed(2)} €`,
      outlook:
        pnl.pnlEur >= 0
          ? "Pression vendeuse intacte — laisser courir vers le TP."
          : "Relance dans la tendance baissière — pas encore de sortie.",
    };
  }
  return {
    action: "wait",
    reason: `Signal mixte · PnL ${pnl.pnlEur.toFixed(2)} €`,
    outlook: "Lecture partagée — pas de clôture forcée pour l’instant.",
  };
}

function parseAiAction(text: string | null): { action: ManageAction; reason: string } | null {
  if (!text) return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as Record<string, unknown>;
    const raw = String(o.action || "").toLowerCase();
    const action: ManageAction =
      raw.includes("flip") || raw.includes("bascul")
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
        signal: AbortSignal.timeout(20_000),
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
      signal: AbortSignal.timeout(20_000),
    });
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return j.choices?.[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  }
}

async function aiDecision(
  trade: PaperTrade,
  frames: TimeframeFrame[],
  price: number,
  pnl: { pnlPct: number; pnlEur: number },
): Promise<{ action: ManageAction; reason: string; providers: string[] } | null> {
  const ind = (frames.find((f) => f.interval === "1h") ?? frames[0])?.indicators;
  const ctx = {
    coin: trade.coin,
    side: trade.side,
    entry: trade.entry,
    price,
    tp: trade.tp,
    sl: trade.sl,
    pnlPct: Math.round(pnl.pnlPct * 100) / 100,
    pnlEur: Math.round(pnl.pnlEur * 100) / 100,
    tf: frames.map((f) => ({ i: f.interval, bias: f.bias, score: f.score })),
    rsi1h: ind?.rsi14 ?? null,
    resistance: ind?.resistance ?? null,
    support: ind?.support ?? null,
  };
  const prompt = `Tu gères un trade paper OUVERT avec PnL live. FR. PAS un conseil financier.
Actions:
- "close" : sortir (setup mort, zone majeure, perte qui empire, TP proche)
- "flip" : sortir + sens inverse (retournement 1h+4h)
- "wait" : garder, attendre confirmation
- "hold" : laisser courir (rebond/rechute encore probable dans le sens du trade)
JSON: {"action":"close|flip|wait|hold","reason":"1 phrase avec PnL"}
Trade: ${JSON.stringify(ctx)}`;

  const opinions: { provider: string; action: ManageAction; reason: string }[] = [];
  // ChatGPT d’abord (plus rapide) ; Claude optionnel
  for (const p of ["openai", "anthropic"] as const) {
    const txt = await askProvider(p, prompt);
    const parsed = parseAiAction(txt);
    if (parsed) opinions.push({ provider: p, ...parsed });
  }
  if (!opinions.length) return null;
  const providers = opinions.map((o) => o.provider);
  const uniq = new Set(opinions.map((o) => o.action));
  if (uniq.size === 1) {
    return {
      action: opinions[0].action,
      reason: opinions.map((o) => `${o.provider}: ${o.reason}`).join(" · "),
      providers,
    };
  }
  if (opinions.length === 1) {
    return {
      action: opinions[0].action,
      reason: `${opinions[0].provider}: ${opinions[0].reason}`,
      providers,
    };
  }
  return null;
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

function buildSnapshot(
  trade: PaperTrade,
  frames: TimeframeFrame[],
  price: number,
  pnl: { pnlPct: number; pnlEur: number },
  action: ManageAction,
  reason: string,
  outlook: string,
  providers: string[],
): TradeManageSnapshot {
  const f1h = frames.find((f) => f.interval === "1h") ?? frames[0];
  const f4h = frames.find((f) => f.interval === "4h") ?? f1h;
  const ind = f1h?.indicators;
  return {
    at: Date.now(),
    action,
    reason: reason.slice(0, 280),
    price,
    pnlEur: Math.round(pnl.pnlEur * 100) / 100,
    pnlPct: Math.round(pnl.pnlPct * 100) / 100,
    bias1h: f1h?.bias ?? "neutre",
    bias4h: f4h?.bias ?? "neutre",
    support: ind?.support ?? null,
    resistance: ind?.resistance ?? null,
    providers,
    outlook: outlook.slice(0, 280),
  };
}

/** Évalue un trade ouvert (paper ou stub live) → snapshot close/flip/wait/hold. */
export async function evaluateTradeManage(opts: {
  trade: PaperTrade;
  frames: TimeframeFrame[];
  price: number;
  pnl: { pnlPct: number; pnlEur: number; movePct?: number };
  skipAi?: boolean;
  lastSnapshotAt?: number;
}): Promise<{
  action: ManageAction;
  reason: string;
  outlook: string;
  providers: string[];
  snapshot: TradeManageSnapshot;
  aiUsed: boolean;
}> {
  const pnl = {
    pnlPct: opts.pnl.pnlPct,
    pnlEur: opts.pnl.pnlEur,
    movePct: opts.pnl.movePct ?? opts.pnl.pnlPct / Math.max(1, opts.trade.leverage),
  };
  const det = deterministicDecision(opts.trade, opts.frames, opts.price, pnl);
  let action = det.action;
  let reason = det.reason;
  let outlook = det.outlook;
  let providers = ["règles+PnL"];
  let aiUsed = false;

  const lastAt = opts.lastSnapshotAt ?? 0;
  const stale = Date.now() - lastAt > 3 * 60_000;
  const critical = det.action === "close" || det.action === "flip";
  if (!opts.skipAi && (stale || critical)) {
    const ai = await aiDecision(opts.trade, opts.frames, opts.price, pnl);
    if (ai) {
      aiUsed = true;
      if (ai.action === "close" || ai.action === "flip") {
        action = ai.action;
        reason = ai.reason;
        providers = ai.providers;
        outlook =
          ai.action === "close"
            ? "IA + structure : sortie recommandée."
            : "IA + structure : retournement — bascule.";
      } else if (det.action === "hold" || det.action === "wait") {
        action = ai.action;
        reason = `${det.reason} · ${ai.reason}`;
        providers = [...ai.providers, "règles+PnL"];
        outlook = det.outlook;
      }
    }
  }

  return {
    action,
    reason,
    outlook,
    providers,
    aiUsed,
    snapshot: buildSnapshot(
      opts.trade,
      opts.frames,
      opts.price,
      pnl,
      action,
      reason,
      outlook,
      providers,
    ),
  };
}

/**
 * Relit chaque trade ouvert : prix mid HL + TF + PnL live → close/flip/wait/hold.
 * skipAi=true : chemin rapide pour poll UI (règles + PnL, sans LLM).
 */
export async function manageOpenTrades(opts?: {
  notify?: boolean;
  max?: number;
  skipAi?: boolean;
}): Promise<ManageResult> {
  const prefs = await loadPrefs();
  const notify = opts?.notify !== false && prefs.telegramEnabled && !opts?.skipAi;
  const list = await loadPaperTrades();
  const open = list
    .filter((t) => t.status === "open")
    .slice(0, opts?.max ?? 12);
  const decisions: ManageDecision[] = [];
  const notes: string[] = [];
  let aiUsed = false;
  const mids = await loadMids();

  for (const trade of open) {
    let frames: TimeframeFrame[] = [];
    try {
      frames = await analyzeCoinFrames(trade.coin, [
        { interval: "15m", horizon: "très court (15m)" },
        { interval: "1h", horizon: "court (1h)" },
        { interval: "4h", horizon: "moyen (4h)" },
      ]);
    } catch {
      frames = [];
    }
    if (!frames.length) continue;

    const candlePx =
      frames.find((f) => f.interval === "1h")?.indicators?.price ??
      frames[0]?.indicators?.price ??
      0;
    const mid = mids[trade.coin.toUpperCase()] ?? 0;
    const price = mid > 0 ? mid : candlePx > 0 ? candlePx : trade.markPx ?? trade.entry;
    const pnl = livePnl(trade, price);

    // Maj mark/PnL immédiatement (même si hold)
    trade.markPx = price;
    trade.pnlPct = pnl.pnlPct;
    trade.pnlEur = pnl.pnlEur;

    const evaluated = await evaluateTradeManage({
      trade,
      frames,
      price,
      pnl,
      skipAi: opts?.skipAi,
      lastSnapshotAt: trade.manageSnapshot?.at,
    });
    if (evaluated.aiUsed) aiUsed = true;
    const { action, reason, outlook, providers } = evaluated;
    const snap = evaluated.snapshot;
    trade.manageSnapshot = snap;

    decisions.push({
      id: trade.id,
      coin: trade.coin,
      side: trade.side,
      action,
      reason,
      price,
      pnlEur: pnl.pnlEur,
      providers,
      outlook,
    });

    const tag = providers.includes("règles+PnL") && providers.length === 1 ? "Relecture" : "IA";

    if (action === "close" || action === "flip") {
      const netEur = pnl.pnlEur;
      trade.status = "closed_manual";
      trade.closedAt = Date.now();
      trade.exitPx = price;
      trade.markPx = price;
      trade.pnlPct = pnl.pnlPct;
      trade.pnlEur = netEur;
      trade.closeNotified = true;
      trade.note =
        `${tag}: ${action === "flip" ? "bascule" : "clôture"} @ ${price} — net ${netEur.toFixed(2)} € · ${reason}`.slice(
          0,
          220,
        );
      if (notify) {
        notes.push(
          [
            `${action === "flip" ? "🔄 Bascule" : "📉 Clôture"} · ${trade.side.toUpperCase()} ${trade.coin}`,
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
          ?.indicators;
        const lv = computeTradeLevels(oppSide, price, ind, 66);
        const notionalEur = trade.marginEur * trade.leverage;
        const now = Date.now();
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
            note: `Bascule depuis ${trade.side.toUpperCase()} · ${reason}`.slice(0, 220),
            portfolioId: trade.portfolioId || "default",
            portfolioName: trade.portfolioName || "Défaut (sûr)",
            justification: null,
            manageSnapshot: {
              at: now,
              action: "hold",
              reason: "Ouverture par bascule — surveillance active",
              price,
              pnlEur: 0,
              pnlPct: 0,
              bias1h: frames.find((f) => f.interval === "1h")?.bias ?? "neutre",
              bias4h: frames.find((f) => f.interval === "4h")?.bias ?? "neutre",
              support: ind?.support ?? null,
              resistance: ind?.resistance ?? null,
              providers,
              outlook: "Nouveau trade après retournement — laisser se poser.",
            },
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
      trade.note =
        `${action === "wait" ? "Attendre" : "Laisser courir"} · PnL ${pnl.pnlEur >= 0 ? "+" : ""}${pnl.pnlEur.toFixed(2)} € · ${reason}`.slice(
          0,
          220,
        );
    }
  }

  await savePaperTrades(list);

  let telegramSent = false;
  for (const text of notes.slice(0, 10)) {
    const r = await sendTelegramMessage(text);
    telegramSent = telegramSent || r.ok;
  }

  return {
    reviewed: open.length,
    decisions,
    telegramSent,
    aiUsed,
    trades: list.filter((t) => t.status === "open" || t.status === "pending").slice(0, 40),
  };
}
