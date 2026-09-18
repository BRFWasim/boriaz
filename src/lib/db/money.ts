/** Helpers Decimal pour calculs financiers (jamais Number float brut). */

import Decimal from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

export function d(value: string | number | Decimal | null | undefined): Decimal {
  if (value == null || value === "") return new Decimal(0);
  if (value instanceof Decimal) return value;
  return new Decimal(String(value));
}

export function dStr(
  value: string | number | Decimal | null | undefined,
  places = 12,
): string {
  return d(value).toFixed(places);
}

export function dNumSafe(
  value: string | number | Decimal | null | undefined,
): number {
  // Conversion contrôlée pour APIs legacy Number — préférer dStr en DB.
  return d(value).toNumber();
}
