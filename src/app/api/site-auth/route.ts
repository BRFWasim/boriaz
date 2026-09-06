import { NextResponse } from "next/server";
import {
  SITE_GATE_COOKIE,
  expectedSiteGateToken,
  passwordMatches,
  sitePasswordConfigured,
} from "@/lib/site-gate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST { password } → cookie portail. DELETE → logout. */
export async function POST(request: Request) {
  if (!sitePasswordConfigured()) {
    return NextResponse.json({
      ok: true,
      disabled: true,
      note: "SITE_PASSWORD non défini — portail désactivé.",
    });
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
    maxAge: 60 * 60 * 24 * 30, // 30 jours
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

export async function GET() {
  return NextResponse.json({
    enabled: sitePasswordConfigured(),
    note: sitePasswordConfigured()
      ? "Portail actif — UI protégée. /api/cron reste accessible via CRON_SECRET."
      : "Portail off — définis SITE_PASSWORD sur Vercel pour activer.",
  });
}
