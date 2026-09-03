import {
  ensureSession,
  loginUser,
  publicUser,
  registerUser,
  setSessionCookie,
} from "@/lib/accounts";
import { setPersistUser } from "@/lib/persist";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await ensureSession();
  setPersistUser(user.id);
  return Response.json({ user: publicUser(user) });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: string;
      name?: string;
      pin?: string;
    };
    const current = await ensureSession();
    if (body.action === "register") {
      const user = await registerUser(
        String(body.name || ""),
        String(body.pin || ""),
        current.id,
      );
      await setSessionCookie(user.id);
      setPersistUser(user.id);
      return Response.json({ user: publicUser(user) });
    }
    if (body.action === "login") {
      const user = await loginUser(String(body.name || ""), String(body.pin || ""));
      await setSessionCookie(user.id);
      setPersistUser(user.id);
      return Response.json({ user: publicUser(user) });
    }
    return Response.json({ user: publicUser(current) });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Compte impossible" },
      { status: 400 },
    );
  }
}
