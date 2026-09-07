import { after } from "next/server";
import { runCronWork, type CronPhase } from "@/lib/cron-runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Travail continue après la réponse HTTP (cron-job.org = 30s max). */
export const maxDuration = 120;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return true;
  const header = request.headers.get("authorization") || "";
  const url = new URL(request.url);
  const q = url.searchParams.get("secret");
  return header === `Bearer ${secret}` || q === secret;
}

function parsePhase(request: Request): CronPhase {
  const p = new URL(request.url).searchParams.get("phase");
  if (p === "manage" || p === "signals") return p;
  return "all";
}

/**
 * ACK immédiat (<2s) pour cron-job.org (timeout 30s).
 * Le bot continue en arrière-plan jusqu’à maxDuration (120s).
 *
 * URLs :
 * - /api/cron?secret=XXX              → tout (manage d’abord, puis signaux)
 * - /api/cron?secret=XXX&phase=manage → seulement trades ouverts
 * - /api/cron?secret=XXX&phase=signals → seulement nouveaux signaux
 */
export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const phase = parsePhase(request);
  const startedAt = Date.now();

  after(async () => {
    try {
      const out = await runCronWork(phase);
      console.info("cron after done", {
        phase: out.phase,
        ok: out.ok,
        ms: Date.now() - startedAt,
        keys: Object.keys(out.results),
      });
    } catch (e) {
      console.error("cron after failed", e);
    }
  });

  return Response.json({
    ok: true,
    accepted: true,
    phase,
    mode: "ack-after",
    at: startedAt,
    note: "Réponse immédiate — travail bot en arrière-plan (OK pour timeout cron 30s).",
  });
}
