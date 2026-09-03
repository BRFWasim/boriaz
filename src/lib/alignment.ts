import type { SignalBias } from "./types";
import type { CrowdFlowSignal } from "./types";
import type { TfVote } from "./signal-score";

export interface AlignmentParts {
  /** 0–100 : multi-TF (1h/4h/1d) */
  tf: number;
  /** 0–100 : crowd wallets WR + sample */
  crowd: number;
  /** 0–100 : flux Nansen directionnel */
  nansen: number;
  /** 0–100 : accord IA (ou neutre 50 si absente) */
  ia: number;
}

export interface AlignmentScore {
  /** Score unique = moyenne géométrique des 4 parties (TF × crowd × Nansen × IA). */
  score: number;
  parts: AlignmentParts;
  label: "fort" | "moyen" | "faible" | "bloqué";
  /** 1h et 4h même sens (long/short). */
  tf1h4hAligned: boolean;
  /** Crowd WR utile (≥58 % et sample OK). */
  crowdWrOk: boolean;
  /** Sureté max : 1h+4h alignés + crowd WR. */
  maxSafetyPass: boolean;
  divergence: string | null;
  breakdown: string;
}

function clamp100(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function sideFromBias(bias: SignalBias, score: number): "long" | "short" | "wait" {
  if (bias === "haussier" || score >= 3) return "long";
  if (bias === "baissier" || score <= -3) return "short";
  return "wait";
}

function geometricMean(parts: number[]): number {
  const safe = parts.map((p) => Math.max(1, p) / 100);
  const product = safe.reduce((a, b) => a * b, 1);
  return clamp100(Math.pow(product, 1 / parts.length) * 100);
}

/**
 * Score Alignement unique visible avant tout trade.
 * Alignement = TF × crowd × Nansen × IA (moyenne géométrique 0–100).
 */
export function computeAlignment(input: {
  action: "long" | "short" | "wait";
  confidence: number;
  tfVotes: TfVote[];
  crowd: CrowdFlowSignal | undefined;
  nansenLong: number;
  nansenShort: number;
  /** Confiance IA 0–100, ou null si pas d’IA. */
  iaConfidence: number | null;
  /** Action suggérée par le 1h seul (pour divergences). */
  action1hHint?: "long" | "short" | "wait";
}): AlignmentScore {
  const vote1h = input.tfVotes.find((v) => v.interval === "1h");
  const vote4h = input.tfVotes.find((v) => v.interval === "4h");
  const vote1d = input.tfVotes.find((v) => v.interval === "1d");

  const side1h = vote1h
    ? sideFromBias(vote1h.bias, vote1h.score)
    : "wait";
  const side4h = vote4h
    ? sideFromBias(vote4h.bias, vote4h.score)
    : "wait";

  const alignedSame =
    input.action !== "wait" &&
    side1h === input.action &&
    side4h === input.action;
  const tf1h4hAligned =
    side1h !== "wait" && side4h !== "wait" && side1h === side4h;

  let tf = 28;
  if (vote1h) tf += Math.min(28, Math.abs(vote1h.score) * 4);
  if (vote4h) tf += Math.min(28, Math.abs(vote4h.score) * 3.5);
  const vote1w = input.tfVotes.find((v) => v.interval === "1w");
  if (vote1d && sideFromBias(vote1d.bias, vote1d.score) === input.action) {
    tf += 12;
  }
  if (vote1w && sideFromBias(vote1w.bias, vote1w.score) === input.action) {
    tf += 10;
  }
  if (alignedSame) tf += 10;
  if (tf1h4hAligned && input.action === side1h) tf += 8;
  if (input.action === "wait") tf = Math.min(tf, 42);
  tf = clamp100(tf);

  let crowd = 35;
  let crowdWrOk = false;
  const c = input.crowd;
  if (c) {
    const wrPct =
      c.avgWinRate <= 1.5 ? c.avgWinRate * 100 : c.avgWinRate;
    crowdWrOk = wrPct >= 58 && c.qualityWhaleCount >= 1;
    crowd = 40 + Math.min(35, Math.max(0, wrPct - 50) * 1.2);
    crowd += Math.min(20, c.qualityWhaleCount * 5);
    if (c.side === input.action) crowd += 8;
    else if (c.side && input.action !== "wait" && c.side !== input.action) {
      crowd = Math.max(15, crowd - 25);
    }
  } else if (input.action !== "wait") {
    crowd = 32;
  }
  crowd = clamp100(crowd);

  let nansen = 40;
  if (input.action === "long") {
    nansen = 35 + Math.min(50, input.nansenLong * 12);
    if (input.nansenShort > input.nansenLong) nansen = Math.max(20, nansen - 15);
  } else if (input.action === "short") {
    nansen = 35 + Math.min(50, input.nansenShort * 12);
    if (input.nansenLong > input.nansenShort) nansen = Math.max(20, nansen - 15);
  } else {
    nansen = 45;
  }
  nansen = clamp100(nansen);

  const ia =
    input.iaConfidence != null
      ? clamp100(input.iaConfidence)
      : 50;

  const parts: AlignmentParts = { tf, crowd, nansen, ia };
  const score = geometricMean([tf, crowd, nansen, ia]);

  let label: AlignmentScore["label"] = "faible";
  if (score >= 72 && tf1h4hAligned && crowdWrOk) label = "fort";
  else if (score >= 58) label = "moyen";
  else if (input.action === "wait" || score < 40) label = "bloqué";

  const maxSafetyPass =
    input.action !== "wait" && tf1h4hAligned && crowdWrOk && score >= 55;

  const hint = input.action1hHint ?? side1h;
  let divergence: string | null = null;
  if (hint === "long" && input.action === "wait") {
    const why: string[] = [];
    if (!tf1h4hAligned) why.push("4h non aligné");
    if (!crowdWrOk) why.push("crowd WR insuffisant");
    if (c?.side === "short") why.push("crowd SHORT");
    if (score < 50) why.push(`Alignement ${score} trop bas`);
    divergence = `Analyse 1h LONG mais signal WAIT — conflit ${why.join(" · ") || "filtres sureté"}`;
  } else if (hint === "short" && input.action === "wait") {
    const why: string[] = [];
    if (!tf1h4hAligned) why.push("4h non aligné");
    if (!crowdWrOk) why.push("crowd WR insuffisant");
    if (c?.side === "long") why.push("crowd LONG");
    if (score < 50) why.push(`Alignement ${score} trop bas`);
    divergence = `Analyse 1h SHORT mais signal WAIT — conflit ${why.join(" · ") || "filtres sureté"}`;
  } else if (
    hint !== "wait" &&
    input.action !== "wait" &&
    hint !== input.action
  ) {
    divergence = `Analyse 1h ${hint.toUpperCase()} mais signal ${input.action.toUpperCase()} — conflit sens`;
  }

  return {
    score,
    parts,
    label,
    tf1h4hAligned,
    crowdWrOk,
    maxSafetyPass,
    divergence,
    breakdown: `TF ${tf} × crowd ${crowd} × Nansen ${nansen} × IA ${ia} → ${score}`,
  };
}
