import { NextResponse } from "next/server";
import {
  SITE_GATE_COOKIE,
  expectedSiteGateToken,
  passwordMatches,
  siteGateTokenValid,
  sitePasswordConfigured,
} from "@/lib/site-gate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST { password } → cookie portail. DELETE → logout. */
export async function POST(request: Request) {
  if (!sitePasswordConfigured()) {
    return NextResponse.json(
      {
        error:
          "SITE_PASSWORD non défini sur Vercel — impossible de se connecter.",
      },
      { status: 503 },
    );
  }

  let password = "";
  try {
    const body = (await request.json()) as { password?: string };
    password = String(body.password ?? "");
  } catch {
    return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 });
  }

  if (!(await passwordMatches(password))) {
    return NextResponse.json({ error: "Mot de passe incorrect" }, { status: 401 });
  }

  const token = await expectedSiteGateToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: SITE_GATE_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 an
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: SITE_GATE_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}

export async function GET(request: Request) {
  const configured = sitePasswordConfigured();
  let authenticated = false;
  if (configured) {
    const cookie = request.headers.get("cookie") || "";
    const match = cookie.match(
      new RegExp(`(?:^|;\\s*)${SITE_GATE_COOKIE}=([^;]+)`),
    );
    const token = match?.[1] ? decodeURIComponent(match[1]) : null;
    authenticated = await siteGateTokenValid(token);
  }
  return NextResponse.json({
    /** Toujours true côté UI : Login visible, Boriaz/Lab privés sans cookie. */
    enabled: true,
    configured,
    authenticated,
    note: configured
      ? "Portail actif — Boriaz + Lab après login. /api/cron reste libre (bot en fond)."
      : "Définis SITE_PASSWORD sur Vercel puis redéploie — sans ça Login ne peut pas ouvrir Boriaz/Lab.",
  });
}
