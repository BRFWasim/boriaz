import { NextResponse, type NextRequest } from "next/server";
import {
  SITE_GATE_COOKIE,
  siteGateTokenValid,
  sitePasswordConfigured,
} from "@/lib/site-gate";
import { SITE_FORCE_OFF } from "@/lib/kill-switches";

/**
 * Portail soft (quand SITE_FORCE_OFF=false) :
 * - Pages publiques ouvertes
 * - APIs privées derrière cookie Login
 * - /api/cron JAMAIS bloqué → bot en fond
 */

const PRIVATE_API_PREFIXES = [
  "/api/live-account",
  "/api/live-status",
  "/api/live-mirror",
  "/api/live-close",
  "/api/live-repair",
  "/api/live-trade",
  "/api/live",
  "/api/paper",
  "/api/prefs",
  "/api/signals",
  "/api/journal",
  "/api/smc",
  "/api/manage",
];

function isPrivateApi(pathname: string): boolean {
  return PRIVATE_API_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/icon") ||
    pathname.startsWith("/manifest")
  ) {
    return NextResponse.next();
  }

  // Site coupé — 503 partout (cron ACK léger côté route, travail no-op)
  if (SITE_FORCE_OFF) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        {
          error: "Site désactivé",
          offline: true,
          message: "BoriazBot est coupé — analyses / ChatGPT / UI off.",
        },
        { status: 503 },
      );
    }
    return new NextResponse(
      `<!doctype html><html lang="fr"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>BoriazBot — hors ligne</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#1a2744;color:#e8f0f8}main{max-width:28rem;padding:2rem;text-align:center}h1{font-size:1.35rem;margin:0 0 .75rem}p{opacity:.8;line-height:1.5;margin:0}</style></head><body><main><h1>BoriazBot est hors ligne</h1><p>Site, analyses et ChatGPT sont coupés. Aucun trade LIVE.</p></main></body></html>`,
      {
        status: 503,
        headers: { "content-type": "text/html; charset=utf-8" },
      },
    );
  }

  if (
    pathname === "/login" ||
    pathname.startsWith("/api/site-auth") ||
    pathname.startsWith("/api/cron")
  ) {
    return NextResponse.next();
  }

  if (!isPrivateApi(pathname)) {
    return NextResponse.next();
  }

  if (!sitePasswordConfigured()) {
    return NextResponse.json(
      {
        error:
          "SITE_PASSWORD manquant sur Vercel — Boriaz / Lab verrouillés jusqu’à configuration + login.",
      },
      { status: 503 },
    );
  }

  const token = request.cookies.get(SITE_GATE_COOKIE)?.value;
  if (await siteGateTokenValid(token)) {
    return NextResponse.next();
  }

  return NextResponse.json(
    { error: "Login requis — onglets Boriaz / Lab privés." },
    { status: 401 },
  );
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
