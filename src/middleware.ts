import { NextResponse, type NextRequest } from "next/server";
import {
  SITE_GATE_COOKIE,
  siteGateTokenValid,
  sitePasswordConfigured,
} from "@/lib/site-gate";

/**
 * Portail d’accès humain uniquement.
 * Exempte /api/cron → le bot continue en fond (cron-job.org / Vercel Cron).
 */
export async function middleware(request: NextRequest) {
  if (!sitePasswordConfigured()) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  // Assets + login + auth API
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/icon") ||
    pathname.startsWith("/manifest") ||
    pathname === "/login" ||
    pathname.startsWith("/api/site-auth")
  ) {
    return NextResponse.next();
  }

  // Bot / cron en fond — JAMAIS bloqué par le mot de passe site
  if (pathname.startsWith("/api/cron")) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SITE_GATE_COOKIE)?.value;
  if (await siteGateTokenValid(token)) {
    return NextResponse.next();
  }

  // API → 401 JSON (pas de redirect HTML)
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Accès site requis — connecte-toi sur /login" },
      { status: 401 },
    );
  }

  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    /*
     * Tout sauf fichiers statiques courants.
     * /api/cron est dans le matcher mais exempté dans le handler.
     */
    "/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
