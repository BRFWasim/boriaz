import type { SignalBias, TimeframeFrame } from "./types";
import type { CrowdFlowSignal } from "./types";

export interface TfVote {
  interval: string;
  bias: SignalBias;
  score: number;
}

export interface CorrelatedSetup {
  action: "long" | "short" | "wait";
  confidence: number;
  certainty: "haute" | "moyenne" | "basse";
  bias: SignalBias;
  scoreBlend: number;
  tfVotes: TfVote[];
  alignedCount: number;
  reason: string;
  /** TF principal pour niveaux (préfère 4h puis 1h). */
  primary: TimeframeFrame;
}

function voteSide(bias: SignalBias, score: number): "long" | "short" | "wait" {
  if (bias === "haussier" || score >= 3) return "long";
  if (bias === "baissier" || score <= -3) return "short";
  return "wait";
}

/**
 * Corrélation multi-TF + crowd wallets WR.
 * Ex. UNI 1h haussier + 4h neutre/haussier → LONG (pas ignoré).
 */
export function correlateSetup(input: {
  coin: string;
  frames: TimeframeFrame[];
  crowd: CrowdFlowSignal | undefined;
  nansenLong: number;
  nansenShort: number;
}): CorrelatedSetup {
  const frames = input.frames;
  if (!frames.length) {
    throw new Error(`Pas de frames pour ${input.coin}`);
  }

  const primary =
    frames.find((f) => f.interval === "4h") ??
    frames.find((f) => f.interval === "1h") ??
    frames[0]!;

  const tfVotes: TfVote[] = frames.map((f) => ({
    interval: f.interval,
    bias: f.bias,
    score: f.score,
  }));

  const longVotes = tfVotes.filter(
    (v) => v.bias === "haussier" || v.score >= 2,
  ).length;
  const shortVotes = tfVotes.filter(
    (v) => v.bias === "baissier" || v.score <= -2,
  ).length;

  const score1h = frames.find((f) => f.interval === "1h")?.score ?? 0;
  const bias1h = frames.find((f) => f.interval === "1h")?.bias;
  const score4h = frames.find((f) => f.interval === "4h")?.score ?? primary.score;
  const bias4h = frames.find((f) => f.interval === "4h")?.bias ?? primary.bias;
  const score1d = frames.find((f) => f.interval === "1d")?.score ?? 0;
  const bias1d = frames.find((f) => f.interval === "1d")?.bias;
  const score1w = frames.find((f) => f.interval === "1w")?.score ?? 0;
  const bias1w = frames.find((f) => f.interval === "1w")?.bias;

  // Blend : 1h timing, 4h tendance, 1d+1w pèsent pour ne plus rater un trend
  const scoreBlend =
    (bias1h ? score1h * 0.25 : 0) +
    score4h * 0.3 +
    score1d * 0.28 +
    (bias1w ? score1w * 0.17 : 0);

  let action: "long" | "short" | "wait" = "wait";
  let confidence = 38;
  const reasons: string[] = [];

  // --- Crowd wallets qualité (WR) : fort poids ---
  const crowd = input.crowd;
  if (crowd) {
    const wrPct =
      crowd.avgWinRate <= 1.5
        ? crowd.avgWinRate * 100
        : crowd.avgWinRate;
    const wrBoost = Math.min(18, Math.round(Math.max(0, wrPct - 52) * 0.7));
    const nBoost = Math.min(20, crowd.qualityWhaleCount * 5);
    if (crowd.side === "long") {
      action = "long";
      confidence = 55 + nBoost + wrBoost;
      reasons.push(
        `Crowd LONG ${crowd.qualityWhaleCount} wallets WR~${wrPct.toFixed(0)}%`,
      );
    } else if (crowd.side === "short") {
      action = "short";
      confidence = 55 + nBoost + wrBoost;
      reasons.push(
        `Crowd SHORT ${crowd.qualityWhaleCount} wallets WR~${wrPct.toFixed(0)}%`,
      );
    }
  }

  // --- Multi-TF : 1h haussier ne doit PLUS être ignoré ---
  if (bias1h === "haussier" && score1h >= 3) {
    if (action === "wait" || action === "long") {
      action = "long";
      confidence = Math.max(confidence, 58 + Math.min(20, score1h * 4));
      reasons.push(`1h HAUSSIER (score ${score1h})`);
    } else if (action === "short" && score1h >= 5) {
      // conflit fort 1h vs crowd short → attendre
      action = "wait";
      confidence = 45;
      reasons.push(`Conflit 1h haussier vs crowd short → WAIT`);
    }
  }
  if (bias1h === "baissier" && score1h <= -3) {
    if (action === "wait" || action === "short") {
      action = "short";
      confidence = Math.max(confidence, 58 + Math.min(20, Math.abs(score1h) * 4));
      reasons.push(`1h BAISSIER (score ${score1h})`);
    } else if (action === "long" && score1h <= -5) {
      action = "wait";
      confidence = 45;
      reasons.push(`Conflit 1h baissier vs crowd long → WAIT`);
    }
  }

  // 4h confirme
  if (bias4h === "haussier" && score4h >= 3) {
    if (action === "long" || action === "wait") {
      action = "long";
      confidence = Math.max(confidence, 52 + score4h * 3);
      reasons.push(`4h haussier (${score4h})`);
    }
  }
  if (bias4h === "baissier" && score4h <= -3) {
    if (action === "short" || action === "wait") {
      action = "short";
      confidence = Math.max(confidence, 52 + Math.abs(score4h) * 3);
      reasons.push(`4h baissier (${score4h})`);
    }
  }

  // Alignement multi-TF
  const alignedCount =
    action === "long" ? longVotes : action === "short" ? shortVotes : 0;
  if (action !== "wait" && alignedCount >= 2) {
    confidence += 8;
    reasons.push(`${alignedCount} TF alignés`);
  }
  if (action !== "wait" && alignedCount >= 3) {
    confidence += 6;
    reasons.push(`alignement 1h+4h+1d fort`);
  }

  // Long terme : 1d/1w haussiers = ne pas rester WAIT (cas « ça pète »)
  if (
    action === "wait" &&
    (bias1d === "haussier" || score1d >= 3) &&
    bias1w !== "baissier" &&
    (bias4h === "haussier" || score4h >= 2 || bias1h === "haussier")
  ) {
    action = "long";
    confidence = Math.max(confidence, 64 + Math.min(12, score1d * 2));
    reasons.push(`Long terme haussier (1d ${score1d}${bias1w ? ` · 1w ${score1w}` : ""})`);
  }
  if (
    action === "wait" &&
    (bias1d === "baissier" || score1d <= -3) &&
    bias1w !== "haussier" &&
    (bias4h === "baissier" || score4h <= -2 || bias1h === "baissier")
  ) {
    action = "short";
    confidence = Math.max(confidence, 64 + Math.min(12, Math.abs(score1d) * 2));
    reasons.push(`Long terme baissier (1d ${score1d}${bias1w ? ` · 1w ${score1w}` : ""})`);
  }

  if (action === "long" && (bias1d === "haussier" || score1d >= 3)) {
    confidence += 8;
    reasons.push(`1d confirme LONG`);
  }
  if (action === "long" && (bias1w === "haussier" || score1w >= 3)) {
    confidence += 6;
    reasons.push(`1w confirme LONG`);
  }
  if (action === "short" && (bias1d === "baissier" || score1d <= -3)) {
    confidence += 8;
    reasons.push(`1d confirme SHORT`);
  }

  // Filtre 1d contraire fort
  if (action === "long" && score1d <= -4) {
    confidence -= 12;
    reasons.push(`1d encore baissier (${score1d}) → prudence`);
  }
  if (action === "short" && score1d >= 4) {
    confidence -= 12;
    reasons.push(`1d encore haussier (${score1d}) → prudence`);
  }

  // Buy zone / RSI
  if (
    action === "long" &&
    primary.buyTiming.action === "acheter_zone" &&
    primary.bias !== "baissier"
  ) {
    confidence = Math.max(confidence, primary.buyTiming.confidence);
    reasons.push(`zone d’achat ${primary.buyTiming.action}`);
  }

  // Nansen
  if (action === "long" && input.nansenLong >= 3) {
    confidence += 5;
    reasons.push(`Nansen longs×${input.nansenLong}`);
  }
  if (action === "short" && input.nansenShort >= 3) {
    confidence += 5;
    reasons.push(`Nansen shorts×${input.nansenShort}`);
  }

  // Si seulement 4h neutre et pas de 1h/crowd → wait
  if (
    action === "wait" &&
    primary.buyTiming.action === "acheter_zone" &&
    primary.bias === "haussier"
  ) {
    action = "long";
    confidence = Math.min(72, primary.buyTiming.confidence);
    reasons.push(primary.summary);
  }

  confidence = Math.max(0, Math.min(92, Math.round(confidence)));

  // Certitude
  let certainty: CorrelatedSetup["certainty"] = "basse";
  if (
    confidence >= 72 &&
    alignedCount >= 2 &&
    (crowd || (bias1h && voteSide(bias1h, score1h) === action))
  ) {
    certainty = "haute";
  } else if (confidence >= 60 && (alignedCount >= 1 || crowd)) {
    certainty = "moyenne";
  }

  // Ne pas forcer un trade bas certainty
  if (certainty === "basse" && confidence < 58) {
    action = "wait";
  }

  const bias: SignalBias =
    action === "long" ? "haussier" : action === "short" ? "baissier" : "neutre";

  return {
    action,
    confidence,
    certainty,
    bias,
    scoreBlend,
    tfVotes,
    alignedCount,
    reason:
      reasons.join(" · ") ||
      primary.summary ||
      `Blend score ${scoreBlend.toFixed(1)}`,
    primary,
  };
}
