import { NextResponse, type NextRequest } from "next/server";
import {
  SITE_GATE_COOKIE,
  siteGateTokenValid,
  sitePasswordConfigured,
} from "@/lib/site-gate";

/**
 * Portail soft :
 * - Pages publiques (Accueil, Baleines, etc.) ouvertes
 * - APIs privées (live, lab/paper bot) derrière cookie
 * - /api/cron JAMAIS bloqué → bot en fond
 */

const PRIVATE_API_PREFIXES = [
  "/api/live-account",
  "/api/live-status",
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
  if (!sitePasswordConfigured()) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/icon") ||
    pathname.startsWith("/manifest") ||
    pathname === "/login" ||
    pathname.startsWith("/api/site-auth") ||
    pathname.startsWith("/api/cron")
  ) {
    return NextResponse.next();
  }

  // Pages & APIs publiques → OK sans login
  if (!isPrivateApi(pathname)) {
    return NextResponse.next();
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
