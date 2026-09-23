import { after } from "next/server";
import { runCronWork, type CronPhase } from "@/lib/cron-runner";
import { saveCronStatus } from "@/lib/cron-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/** Travail continue après la réponse HTTP (cron-job.org = 30s max). */
export const maxDuration = 120;

function authorized(request: Request): { ok: boolean; error?: string } {
  const secret = process.env.CRON_SECRET?.trim();
  // Fail-closed (ARCHITECTURE_AUDIT / RISK) — sans secret le cron ne doit pas trader
  if (!secret) {
    return {
      ok: false,
      error: "CRON_SECRET manquant — cron refusé (fail-closed)",
    };
  }
  const header = request.headers.get("authorization") || "";
  const url = new URL(request.url);
  const q = url.searchParams.get("secret");
  if (header === `Bearer ${secret}` || q === secret) return { ok: true };
  return { ok: false, error: "Unauthorized" };
}

function parsePhase(request: Request): CronPhase {
  const p = new URL(request.url).searchParams.get("phase");
  if (p === "manage" || p === "signals") return p;
  return "all";
}

/**
 * ACK immédiat (<2s) pour cron-job.org (timeout 30s).
 * Heartbeat KV synchrone (before after) — prouve que le cron a été reçu
 * même si `after()` est kill/timeout.
 *
 * URLs :
 * - /api/cron?secret=XXX              → tout (manage d’abord, puis signaux)
 * - /api/cron?secret=XXX&phase=manage → seulement trades ouverts
 * - /api/cron?secret=XXX&phase=signals → seulement nouveaux signaux
 * - /api/cron?secret=XXX&sync=1       → attend le travail (≤95s) puis répond
 */
export async function GET(request: Request) {
  const auth = authorized(request);
  if (!auth.ok) {
    return Response.json(
      { error: auth.error || "Unauthorized" },
      { status: auth.error?.includes("CRON_SECRET") ? 503 : 401 },
    );
  }

  const phase = parsePhase(request);
  const startedAt = Date.now();
  const sync =
    new URL(request.url).searchParams.get("sync") === "1" ||
    new URL(request.url).searchParams.get("sync") === "true";

  // Heartbeat SYNCHRONE — avant after() (after n’est pas fiable sous charge)
  try {
    await saveCronStatus({
      at: startedAt,
      ok: true,
      tick: `${phase}:ack`,
      note: sync ? "sync-start" : "accepted",
    });
  } catch (e) {
    console.error("cron heartbeat failed", e);
  }

  if (sync) {
    try {
      const out = await runCronWork(phase);
      return Response.json({
        ok: out.ok,
        accepted: true,
        phase,
        mode: "sync",
        at: startedAt,
        ms: Date.now() - startedAt,
        results: {
          manageError: out.results.manageError ?? null,
          signalsError: out.results.signalsError ?? null,
          signals: out.results.signals ?? null,
        },
      });
    } catch (e) {
      await saveCronStatus({
        at: Date.now(),
        ok: false,
        tick: phase,
        note: e instanceof Error ? e.message : "sync-failed",
      }).catch(() => undefined);
      return Response.json(
        {
          ok: false,
          phase,
          error: e instanceof Error ? e.message : "sync-failed",
        },
        { status: 500 },
      );
    }
  }

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
      try {
        await saveCronStatus({
          at: Date.now(),
          ok: false,
          tick: phase,
          note: e instanceof Error ? e.message : "after-failed",
        });
      } catch {
        /* ignore */
      }
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
