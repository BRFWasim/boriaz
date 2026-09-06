/** PnL théorique à TP / SL (paper € ou live $). */

export type OutcomeSide = "long" | "short";

/** PnL en $ si le prix sort à `exit` (size = quantité coin). */
export function pnlUsdAtPrice(input: {
  side: OutcomeSide;
  entry: number;
  exit: number;
  size: number;
}): number {
  const { side, entry, exit, size } = input;
  if (!(entry > 0 && exit > 0 && size > 0)) return 0;
  const raw = side === "long" ? (exit - entry) * size : (entry - exit) * size;
  return Math.round(raw * 100) / 100;
}

/** PnL en € paper : marge × move% × levier. */
export function pnlEurAtPrice(input: {
  side: OutcomeSide;
  entry: number;
  exit: number;
  marginEur: number;
  leverage: number;
}): number {
  const { side, entry, exit, marginEur, leverage } = input;
  if (!(entry > 0 && exit > 0 && marginEur > 0 && leverage > 0)) return 0;
  const movePct =
    side === "long"
      ? ((exit - entry) / entry) * 100
      : ((entry - exit) / entry) * 100;
  return Math.round(((marginEur * movePct * leverage) / 100) * 100) / 100;
}

export function tradeOutcomesUsd(input: {
  side: OutcomeSide;
  entry: number;
  tp: number;
  sl: number;
  size: number;
}): { tpPnlUsd: number; slPnlUsd: number } {
  return {
    tpPnlUsd: pnlUsdAtPrice({
      side: input.side,
      entry: input.entry,
      exit: input.tp,
      size: input.size,
    }),
    slPnlUsd: pnlUsdAtPrice({
      side: input.side,
      entry: input.entry,
      exit: input.sl,
      size: input.size,
    }),
  };
}

export function tradeOutcomesEur(input: {
  side: OutcomeSide;
  entry: number;
  tp: number;
  sl: number;
  marginEur: number;
  leverage: number;
}): { tpPnlEur: number; slPnlEur: number } {
  return {
    tpPnlEur: pnlEurAtPrice({
      side: input.side,
      entry: input.entry,
      exit: input.tp,
      marginEur: input.marginEur,
      leverage: input.leverage,
    }),
    slPnlEur: pnlEurAtPrice({
      side: input.side,
      entry: input.entry,
      exit: input.sl,
      marginEur: input.marginEur,
      leverage: input.leverage,
    }),
  };
}

/** Libellé bot pour l’UI (Boriaz / Scalp / Défaut / nom custom). */
export function botLabelFromPortfolio(input: {
  portfolioId?: string | null;
  portfolioName?: string | null;
  strategy?: string | null;
}): string {
  const id = (input.portfolioId || "").toLowerCase();
  const name = (input.portfolioName || "").trim();
  if (id === "boriaz" || input.strategy === "smc") return "Boriaz";
  if (id === "default") return "Défaut";
  if (/scalp/i.test(name)) return "Scalp";
  return name || "Bot";
}
