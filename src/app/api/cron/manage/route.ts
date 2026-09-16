import { after } from "next/server";
import { runCronWork } from "@/lib/cron-runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 90;

function authorized(request: Request): { ok: boolean; error?: string } {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return {
      ok: false,
      error: "CRON_SECRET manquant — cron/manage refusé (fail-closed)",
    };
  }
  const header = request.headers.get("authorization") || "";
  const url = new URL(request.url);
  const q = url.searchParams.get("secret");
  if (header === `Bearer ${secret}` || q === secret) return { ok: true };
  return { ok: false, error: "Unauthorized" };
}

/**
 * Job léger dédié aux trades déjà ouverts (paper + live SMC).
 * ACK immédiat → compatible timeout cron-job.org 30s.
 */
export async function GET(request: Request) {
  const auth = authorized(request);
  if (!auth.ok) {
    return Response.json(
      { error: auth.error || "Unauthorized" },
      { status: auth.error?.includes("CRON_SECRET") ? 503 : 401 },
    );
  }

  const startedAt = Date.now();
  after(async () => {
    try {
      await runCronWork("manage");
      console.info("cron/manage after done", { ms: Date.now() - startedAt });
    } catch (e) {
      console.error("cron/manage after failed", e);
    }
  });

  return Response.json({
    ok: true,
    accepted: true,
    phase: "manage",
    mode: "ack-after",
    at: startedAt,
  });
}
