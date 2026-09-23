/**
 * Politique de côtés LIVE/SMC.
 * HL_ALLOW_SHORT=false (défaut) → Long-only temporaire (anti revenge shorts).
 * Remettre à true pour réautoriser les shorts.
 */

function envTruthy(name: string, fallback = false): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  if (!v) return fallback;
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/** Shorts autorisés ? Défaut false = Long-only. */
export function isShortAllowed(): boolean {
  return envTruthy("HL_ALLOW_SHORT", false);
}

export function isLiveSideAllowed(side: "long" | "short"): boolean {
  if (side === "long") return true;
  return isShortAllowed();
}

export function liveSidesLabel(): "long-only" | "long+short" {
  return isShortAllowed() ? "long+short" : "long-only";
}
