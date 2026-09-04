/**
 * Anti-flip : un signal LONG/SHORT affiché reste collant ~20 min
 * sauf invalidation forte (4h contraire + confiance nette).
 */
export type StickyAction = "long" | "short" | "wait";

interface StickyEntry {
  action: StickyAction;
  confidence: number;
  at: number;
  reason: string;
}

const STICKY_MS = 20 * 60_000;
const stickyMap = new Map<string, StickyEntry>();

/**
 * Stabilise la direction affichée / tradée.
 * - Même sens → on garde (confiance max)
 * - Flip → exige 4hAligned + conf ≥ 68 + delta ≥ +8 vs sticky, ou sticky expiré
 * - Sinon on conserve l’ancien sens (ou WAIT si aucun sticky)
 */
export function stabilizeDirection(input: {
  coin: string;
  action: StickyAction;
  confidence: number;
  tf1h4hAligned: boolean;
  /** 4h est contraire au nouvel action */
  tf4hOpposed: boolean;
}): { action: StickyAction; confidence: number; stickyNote: string | null } {
  const prev = stickyMap.get(input.coin);
  const now = Date.now();

  if (input.action === "wait") {
    // WAIT n’efface le sticky que s’il est vieux ou 4h contraire
    if (prev && now - prev.at < STICKY_MS && !input.tf4hOpposed) {
      return {
        action: prev.action,
        confidence: Math.max(prev.confidence - 4, 50),
        stickyNote: `Sticky ${prev.action.toUpperCase()} (WAIT ignoré <20 min)`,
      };
    }
    return { action: "wait", confidence: input.confidence, stickyNote: null };
  }

  if (!prev || now - prev.at >= STICKY_MS) {
    stickyMap.set(input.coin, {
      action: input.action,
      confidence: input.confidence,
      at: now,
      reason: "nouveau",
    });
    return { action: input.action, confidence: input.confidence, stickyNote: null };
  }

  if (prev.action === input.action) {
    const conf = Math.max(prev.confidence, input.confidence);
    stickyMap.set(input.coin, {
      action: input.action,
      confidence: conf,
      at: prev.at, // garde l’horloge d’origine pour la durée sticky
      reason: "renforcé",
    });
    return { action: input.action, confidence: conf, stickyNote: null };
  }

  // Flip demandé
  const strongFlip =
    input.tf1h4hAligned &&
    !input.tf4hOpposed &&
    input.confidence >= 68 &&
    input.confidence >= prev.confidence + 8;

  if (strongFlip) {
    stickyMap.set(input.coin, {
      action: input.action,
      confidence: input.confidence,
      at: now,
      reason: "flip confirmé 1h+4h",
    });
    return {
      action: input.action,
      confidence: input.confidence,
      stickyNote: `Flip ${prev.action}→${input.action} confirmé multi-TF`,
    };
  }

  // Refuse le flip bruyant
  return {
    action: prev.action,
    confidence: prev.confidence,
    stickyNote: `Anti-flip : garde ${prev.action.toUpperCase()} (besoin 1h+4h + conf≥68)`,
  };
}
