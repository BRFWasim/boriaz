import { formatDistanceStrict } from "date-fns";
import { fr } from "date-fns/locale";

export function parseNum(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function formatUsd(value: number, opts?: { compact?: boolean; digits?: number }): string {
  const compact = opts?.compact ?? Math.abs(value) >= 10_000;
  const sign = value < 0 ? "−" : "";
  const abs = Math.abs(value);

  if (compact) {
    const nf = (div: number, digits: number) =>
      new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits }).format(abs / div);
    if (abs >= 1_000_000_000) return `${sign}${nf(1_000_000_000, 2)} Md$`;
    if (abs >= 1_000_000) return `${sign}${nf(1_000_000, 2)} M$`;
    if (abs >= 1_000) return `${sign}${nf(1_000, 1)} k$`;
  }

  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: opts?.digits ?? (abs < 10 ? 4 : abs < 100 ? 2 : 0),
  }).format(value);
}

export function formatQty(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : abs >= 0.01 ? 5 : 6;
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits }).format(value);
}

export function formatPx(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 1000 ? 1 : abs >= 1 ? 4 : 6;
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: abs >= 1000 ? 1 : 2,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatPct(value: number, digits = 2): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits }).format(Math.abs(value))} %`;
}

export function formatRoi(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "n/d";
  return formatPct(value * 100, 2);
}

export function formatFundingRate(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "n/d";
  return formatPct(value * 100, 4);
}

export function formatWinRate(value: number | null, sample: number): string {
  if (value === null || sample === 0) return "n/d";
  // Accepte fraction 0–1 OU déjà en % (défense)
  const pct = value <= 1.5 ? value * 100 : value;
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(pct)} %`;
}

/** Affiche un winrate de façon certaine (fraction ou %). */
export function formatWinRateSafe(
  winRate: number | null,
  winRatePct: number | null,
  sample: number,
): string {
  if (sample <= 0) return "n/d";
  if (winRatePct !== null && Number.isFinite(winRatePct)) {
    return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(winRatePct)} %`;
  }
  return formatWinRate(winRate, sample);
}

export function riskClass(label: string): string {
  if (label === "critique") return "text-short";
  if (label === "élevé") return "text-amber-300";
  if (label === "modéré") return "text-primary";
  return "text-long";
}

export function truncateAddress(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatExactTime(ts: number): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(ts));
}

/** Heure courte FR (Europe/Paris), ex. 17:42. */
export function formatParisClock(ts: number): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ts));
}

/** Date + heure FR, ex. 05/09/2026 17:42. */
export function formatParisDateTime(ts: number): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ts));
}

export function formatAgo(ts: number, now = Date.now()): string {
  return formatDistanceStrict(new Date(ts), new Date(now), {
    addSuffix: true,
    locale: fr,
  }).replace("environ ", "");
}

export function displayCoin(coin: string): { dex: string | null; symbol: string } {
  const idx = coin.indexOf(":");
  if (idx > 0) {
    return { dex: coin.slice(0, idx), symbol: coin.slice(idx + 1) };
  }
  return { dex: null, symbol: coin };
}

export function signedClass(value: number): string {
  if (value > 0) return "text-long";
  if (value < 0) return "text-short";
  return "text-muted-foreground";
}
