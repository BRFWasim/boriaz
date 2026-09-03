import type {
  BtcAnalysisPayload,
  DashboardPayload,
  HedgeAlert,
  SignalBias,
} from "./types";
import { sendTelegramMessage } from "./telegram";

const sent = new Set<string>();
const SENT_LIMIT = 400;

function remember(key: string): boolean {
  if (sent.has(key)) return false;
  sent.add(key);
  if (sent.size > SENT_LIMIT) {
    const first = sent.values().next().value;
    if (first) sent.delete(first);
  }
  return true;
}

export async function dispatchWhaleAlerts(
  payload: DashboardPayload,
): Promise<{ sent: number; skipped: number; errors: string[] }> {
  let sentCount = 0;
  let skipped = 0;
  const errors: string[] = [];

  const critical = payload.alerts.filter((a) => a.kind === "short_with_spot");
  for (const alert of critical.slice(0, 8)) {
    const key = `whale:${alert.id}:${Math.floor(payload.fetchedAt / 3_600_000)}`;
    if (!remember(key)) {
      skipped += 1;
      continue;
    }
    const text = formatWhaleAlert(alert);
    const result = await sendTelegramMessage(text);
    if (result.ok) sentCount += 1;
    else if (result.error) errors.push(result.error);
  }

  const accum = payload.alerts.filter((a) => a.kind === "spot_only_accumulation");
  for (const alert of accum.slice(0, 3)) {
    const key = `accum:${alert.id}:${Math.floor(payload.fetchedAt / 6_000_000)}`;
    if (!remember(key)) {
      skipped += 1;
      continue;
    }
    const result = await sendTelegramMessage(formatWhaleAlert(alert));
    if (result.ok) sentCount += 1;
    else if (result.error) errors.push(result.error);
  }

  return { sent: sentCount, skipped, errors: [...new Set(errors)] };
}

export async function dispatchBtcAlerts(
  payload: BtcAnalysisPayload,
): Promise<{ sent: number; errors: string[] }> {
  const errors: string[] = [];
  let sentCount = 0;
  const buy = payload.buyTiming;
  if (!buy) return { sent: 0, errors };

  const hourBucket = Math.floor(payload.fetchedAt / 3_600_000);
  if (buy.action === "acheter_zone" || buy.action === "surveiller_achat") {
    const key = `btc-buy:${buy.action}:${hourBucket}`;
    if (remember(key)) {
      const text = [
        "BTC — timing",
        `Action: ${labelAction(buy.action)}`,
        `Confiance: ${buy.confidence}/100`,
        buy.reason,
        buy.levels,
        `Biais technique: ${payload.bias} (score ${payload.score})`,
        `Prix: ${payload.indicators.price.toFixed(0)} · RSI ${payload.indicators.rsi14?.toFixed(1) ?? "n/d"}`,
        "",
        "Pas un conseil financier.",
      ].join("\n");
      const result = await sendTelegramMessage(text);
      if (result.ok) sentCount += 1;
      else if (result.error) errors.push(result.error);
    }
  }

  if (payload.bias === "baissier" && payload.score <= -4) {
    const key = `btc-risk:${hourBucket}`;
    if (remember(key)) {
      const result = await sendTelegramMessage(
        [
          "BTC — alerte biais baissier",
          payload.summary,
          `Score ${payload.score} · RSI ${payload.indicators.rsi14?.toFixed(1) ?? "n/d"}`,
          "Pas un conseil financier.",
        ].join("\n"),
      );
      if (result.ok) sentCount += 1;
      else if (result.error) errors.push(result.error);
    }
  }

  return { sent: sentCount, errors: [...new Set(errors)] };
}

function formatWhaleAlert(alert: HedgeAlert): string {
  return [
    alert.severity === "critical" ? "ALERTE BALEINE" : "INFO BALEINE",
    alert.title,
    alert.detail,
    `Actif: ${alert.baseAsset}`,
    "Source: Hyperliquid public · pas un conseil financier.",
  ].join("\n");
}

function labelAction(action: string): string {
  if (action === "acheter_zone") return "Zone d'achat intéressante à surveiller";
  if (action === "surveiller_achat") return "Surveiller un possible achat";
  if (action === "patienter") return "Patienter";
  if (action === "eviter") return "Éviter d'acheter agressivement";
  return action;
}

export function inferBuyTiming(input: {
  bias: SignalBias;
  score: number;
  rsi: number | null;
  macdHist: number | null;
  price: number;
  support: number | null;
  bbLower: number | null;
}): {
  action: "acheter_zone" | "surveiller_achat" | "patienter" | "eviter";
  confidence: number;
  reason: string;
  levels: string;
} {
  const nearSupport =
    input.support !== null &&
    input.price > 0 &&
    (input.price - input.support) / input.price < 0.02;
  const nearBbLow =
    input.bbLower !== null &&
    input.price > 0 &&
    (input.price - input.bbLower) / input.price < 0.01;
  const oversold = input.rsi !== null && input.rsi <= 35;
  const recoveringMacd = input.macdHist !== null && input.macdHist > 0;

  if (input.score <= -4 && (input.rsi === null || input.rsi > 45)) {
    return {
      action: "eviter",
      confidence: Math.min(90, 50 + Math.abs(input.score) * 8),
      reason:
        "Structure technique baissière dominante : plutôt éviter d’acheter dans le momentum.",
      levels: input.support
        ? `Attendre plutôt autour de ${input.support.toFixed(0)} / confirmation RSI.`
        : "Attendre une stabilisation (RSI/MACD).",
    };
  }

  if ((oversold || nearBbLow || nearSupport) && input.score >= -1) {
    return {
      action: recoveringMacd || oversold ? "acheter_zone" : "surveiller_achat",
      confidence: Math.min(
        88,
        45 + (oversold ? 20 : 0) + (nearSupport ? 10 : 0) + (recoveringMacd ? 10 : 0),
      ),
      reason:
        "Zone intéressante : prix proche support/Bollinger basse et/ou RSI bas, sans structure trop dégradée.",
      levels: [
        input.support ? `Support ~ ${input.support.toFixed(0)}` : null,
        input.bbLower ? `BB basse ~ ${input.bbLower.toFixed(0)}` : null,
        `Prix actuel ${input.price.toFixed(0)}`,
      ]
        .filter(Boolean)
        .join(" · "),
    };
  }

  if (input.bias === "haussier" && input.score >= 3) {
    return {
      action: "surveiller_achat",
      confidence: Math.min(75, 40 + input.score * 6),
      reason:
        "Biais haussier, mais pas forcément le meilleur point d’entrée immédiat (éviter de chase).",
      levels: input.support
        ? `Préférer un pullback vers ${input.support.toFixed(0)} / EMA20.`
        : "Préférer un pullback plutôt qu’un breakout impulsif.",
    };
  }

  return {
    action: "patienter",
    confidence: 40,
    reason: "Pas de confluence claire pour un timing d’achat prioritaire.",
    levels: input.support
      ? `Surveiller ${input.support.toFixed(0)} et le RSI.`
      : "Surveiller RSI < 35 ou retour sur support.",
  };
}
