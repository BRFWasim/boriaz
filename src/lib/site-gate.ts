/**
 * Portail d’accès site (mot de passe global).
 * Compatible Edge (middleware) + Node (API).
 * Le cron / bot en fond N’EST PAS bloqué (exemption /api/cron).
 *
 * Env : SITE_PASSWORD — obligatoire pour Login / onglets Boriaz + Lab.
 * Sans SITE_PASSWORD : Boriaz/Lab restent verrouillés (pas d’accès libre).
 */

export const SITE_GATE_COOKIE = "bb_site_gate";

/** Portefeuilles autorisés à trader en LIVE HL (réel) — Boriaz uniquement. */
export const LIVE_ALLOWED_PORTFOLIO_IDS = new Set(["boriaz"]);

export function isLiveAllowedPortfolio(id: string | null | undefined): boolean {
  return Boolean(id && LIVE_ALLOWED_PORTFOLIO_IDS.has(id));
}

function gateMaterial(): string {
  return (
    process.env.SITE_GATE_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    "boriaz-dev-gate"
  );
}

export function sitePasswordConfigured(): boolean {
  return Boolean(process.env.SITE_PASSWORD?.trim());
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function expectedSiteGateToken(): Promise<string> {
  const password = process.env.SITE_PASSWORD?.trim() || "";
  return sha256Hex(`boriaz-site-gate:v1:${gateMaterial()}:${password}`);
}

export async function siteGateTokenValid(
  token: string | undefined | null,
): Promise<boolean> {
  if (!sitePasswordConfigured()) return false;
  if (!token) return false;
  const expected = await expectedSiteGateToken();
  if (token.length !== expected.length) return false;
  let ok = 0;
  for (let i = 0; i < token.length; i++) {
    ok |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return ok === 0;
}

export async function passwordMatches(input: string): Promise<boolean> {
  const expected = process.env.SITE_PASSWORD?.trim() || "";
  if (!expected) return false;
  if (input.length !== expected.length) return false;
  let ok = 0;
  for (let i = 0; i < input.length; i++) {
    ok |= input.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return ok === 0;
}
