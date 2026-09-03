import type { TradeStats } from "./types";

export type ReliabilityTier = "A" | "B" | "C" | "D" | "n/d";

export interface ReliabilityBadge {
  tier: ReliabilityTier;
  label: string;
  detail: string;
  score: number;
}

/**
 * Score de fiabilité du WR : échantillon min, profit factor, expectancy.
 */
export function wrReliability(stats: TradeStats): ReliabilityBadge {
  const sample = stats.sample;
  if (sample < 8 || stats.winRate === null) {
    return {
      tier: "n/d",
      label: "WR n/d",
      detail: `Échantillon trop faible (${sample}). Min. 8 clôtures |PnL|≥5$.`,
      score: 0,
    };
  }

  const wr = stats.winRate <= 1.5 ? stats.winRate : stats.winRate / 100;
  const pf =
    stats.profitFactor === null
      ? 0
      : Number.isFinite(stats.profitFactor)
        ? stats.profitFactor
        : 3;
  const exp = stats.expectancy ?? 0;

  let score = 0;
  // Sample
  if (sample >= 40) score += 35;
  else if (sample >= 20) score += 28;
  else if (sample >= 12) score += 20;
  else score += 12;

  // WR
  if (wr >= 0.62) score += 25;
  else if (wr >= 0.55) score += 18;
  else if (wr >= 0.48) score += 10;
  else score += 4;

  // PF
  if (pf >= 1.6) score += 25;
  else if (pf >= 1.2) score += 18;
  else if (pf >= 1.0) score += 10;
  else score += 2;

  // Expectancy
  if (exp > 200) score += 15;
  else if (exp > 50) score += 10;
  else if (exp > 0) score += 6;
  else score += 1;

  score = Math.min(100, score);
  const tier: ReliabilityTier =
    score >= 75 ? "A" : score >= 58 ? "B" : score >= 42 ? "C" : "D";

  const pfTxt = Number.isFinite(pf) ? pf.toFixed(2) : "∞";
  return {
    tier,
    label: `Fiab. ${tier}`,
    detail: `n=${sample} · WR ${(wr * 100).toFixed(0)}% · PF ${pfTxt} · E ${exp.toFixed(0)}$ · score ${score}/100`,
    score,
  };
}
