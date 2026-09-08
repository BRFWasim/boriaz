import { after } from "next/server";
import { runCronWork } from "@/lib/cron-runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 90;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return true;
  const header = request.headers.get("authorization") || "";
  const url = new URL(request.url);
  const q = url.searchParams.get("secret");
  return header === `Bearer ${secret}` || q === secret;
}

/**
 * Job léger dédié aux trades déjà ouverts (paper + live SMC).
 * À appeler toutes les 1–2 min (cron-job.org) en plus du cron principal.
 * ACK immédiat → compatible timeout cron-job.org 30s.
 * Relecture PnL live + structure + snapshot sous chaque trade.
 */
export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
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
