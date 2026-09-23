/**
 * Politique de côtés LIVE/SMC.
 *
 * Shorts autorisés (HL_ALLOW_SHORT, défaut true) uniquement si
 * signal « sûr et certain » : continuation D1+H4 baissier, deep ÔTE,
 * pas de correction / H4-lead / shallow.
 */

import type { SmcSetup } from "./smc";

function envTruthy(name: string, fallback = false): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  if (!v) return fallback;
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** Shorts autorisés au niveau env ? Défaut true — qualité filtrée ailleurs. */
export function isShortAllowed(): boolean {
  return envTruthy("HL_ALLOW_SHORT", true);
}

export function isLiveSideAllowed(side: "long" | "short"): boolean {
  if (side === "long") return true;
  return isShortAllowed();
}

export function liveSidesLabel(): "long-only" | "long+short-quality" {
  return isShortAllowed() ? "long+short-quality" : "long-only";
}

/**
 * Short LIVE/paper « sûr et certain » :
 * - continuation alignée D1+H4 (pas H4-lead, pas correction)
 * - deep ÔTE (pas shallow demi-taille)
 */
export function isQualityShortSetup(setup: {
  order?: { side?: string } | null;
  tradeKind?: string | null;
  counterTrend?: boolean;
  h4Lead?: boolean;
  entryStyle?: string | null;
  signalType?: string | null;
}): boolean {
  if (setup.order?.side !== "short") return true;
  if (!isShortAllowed()) return false;
  if (setup.tradeKind !== "continuation") return false;
  if (setup.counterTrend) return false;
  if (setup.h4Lead) return false;
  if (setup.entryStyle === "shallow") return false;
  if (setup.signalType && setup.signalType !== "short_aligned") return false;
  return true;
}

/** Seuils confiance : shorts plus élevés que longs. */
export function minGateConfidenceForSide(setup: SmcSetup): number {
  if (setup.order?.side === "short") {
    if (setup.tradeKind === "correction" || setup.counterTrend) return 95;
    if (setup.h4Lead || setup.entryStyle === "shallow") return 92;
    return 88; // short continuation deep
  }
  if (setup.tradeKind === "correction" || setup.counterTrend) return 82;
  return 75;
}

export function minLiveConfidenceForSide(setup: SmcSetup): number {
  if (setup.order?.side === "short") {
    if (setup.tradeKind === "correction" || setup.counterTrend) return 95;
    if (setup.h4Lead || setup.entryStyle === "shallow") return 92;
    return 90; // sûr et certain avant short LIVE
  }
  if (setup.tradeKind === "correction" || setup.counterTrend) return 88;
  if (setup.entryStyle === "shallow" || setup.h4Lead) return 86;
  return 82;
}
