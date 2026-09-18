import { bindUserRequest } from "@/lib/bind-request";
import { reconcileLiveState } from "@/lib/bot/reconciliation";
import {
  updateRuntimeConfig,
  getRuntimeGate,
  type TradingMode,
} from "@/lib/bot/trading-mode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/bot/control
 * body: { action: "kill-switch"|"mode"|"reconcile", ... }
 * Toute mutation est auditée. Passage live exige confirmation explicite.
 */
export async function POST(request: Request) {
  try {
    await bindUserRequest();
    const body = (await request.json()) as {
      action?: string;
      enabled?: boolean;
      mode?: TradingMode;
      liveTradingEnabled?: boolean;
      confirmLive?: boolean;
      reason?: string;
    };
    const action = String(body.action || "");
    const actor = "ui:authenticated";

    if (action === "reconcile") {
      const report = await reconcileLiveState();
      return Response.json({ ok: true, report });
    }

    if (action === "kill-switch") {
      if (typeof body.enabled !== "boolean") {
        return Response.json({ error: "enabled boolean requis" }, { status: 400 });
      }
      const next = await updateRuntimeConfig({
        actor,
        globalKillSwitch: body.enabled,
        reason: body.reason || "kill-switch UI",
      });
      return Response.json({ ok: true, gate: next });
    }

    if (action === "mode") {
      const mode = body.mode;
      if (mode !== "shadow" && mode !== "paper" && mode !== "live") {
        return Response.json({ error: "mode invalide" }, { status: 400 });
      }
      if (mode === "live") {
        if (!body.confirmLive) {
          return Response.json(
            {
              error:
                "Passage LIVE refusé : confirmLive=true + LIVE_TRADING_ENABLED requis",
            },
            { status: 400 },
          );
        }
        if (body.liveTradingEnabled !== true) {
          return Response.json(
            { error: "liveTradingEnabled=true requis pour mode live" },
            { status: 400 },
          );
        }
      }
      const next = await updateRuntimeConfig({
        actor,
        tradingMode: mode,
        liveTradingEnabled:
          mode === "live" ? true : Boolean(body.liveTradingEnabled),
        // Activer un mode non-live baisse souvent le kill switch? Non — on ne touche pas sauf demandé
        reason: body.reason || `mode→${mode}`,
      });
      return Response.json({ ok: true, gate: next });
    }

    const gate = await getRuntimeGate();
    return Response.json({ error: "action inconnue", gate }, { status: 400 });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "control error" },
      { status: 400 },
    );
  }
}
