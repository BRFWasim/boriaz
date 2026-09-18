import { bindUserRequest } from "@/lib/bind-request";
import {
  isLiveEnvReady,
  placeBoriazLiveTrade,
  type LiveEntryMode,
  type LiveSide,
} from "@/lib/hl-live";
import { noteLiveOpen } from "@/lib/smc-live-gate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/live-trade — ordre LIVE manuel depuis le site (Boriaz).
 * body: { coin, side, entry, tp, sl, leverage?, riskPct?, entryMode?, tp1?, tp2? }
 */
export async function POST(request: Request) {
  try {
    await bindUserRequest();
    const ready = isLiveEnvReady();
    if (!ready.ok) {
      return Response.json(
        { error: ready.reason || "LIVE HL non prêt (env)" },
        { status: 400 },
      );
    }

    const body = (await request.json()) as {
      coin?: string;
      side?: string;
      entry?: number;
      tp?: number;
      sl?: number;
      tp1?: number;
      tp2?: number;
      leverage?: number;
      riskPct?: number;
      entryMode?: string;
    };

    const coin = String(body.coin || "").trim().toUpperCase();
    const sideRaw = String(body.side || "").trim().toLowerCase();
    const side: LiveSide | null =
      sideRaw === "long" || sideRaw === "buy"
        ? "long"
        : sideRaw === "short" || sideRaw === "sell"
          ? "short"
          : null;
    const entry = Number(body.entry);
    const tp = Number(body.tp);
    const sl = Number(body.sl);
    const leverage = Math.min(20, Math.max(1, Math.floor(Number(body.leverage) || 3)));
    const riskPct = Math.min(5, Math.max(0.25, Number(body.riskPct) || 2));
    const modeRaw = String(body.entryMode || "market_now").toLowerCase();
    const entryMode: LiveEntryMode =
      modeRaw === "limit_wait" || modeRaw === "limit" ? "limit_wait" : "market_now";

    if (!coin) {
      return Response.json({ error: "coin requis" }, { status: 400 });
    }
    if (!side) {
      return Response.json({ error: "side long|short requis" }, { status: 400 });
    }
    if (!(entry > 0 && tp > 0 && sl > 0)) {
      return Response.json(
        { error: "entry / tp / sl doivent être > 0" },
        { status: 400 },
      );
    }
    if (side === "long" && !(sl < entry && entry < tp)) {
      return Response.json(
        { error: "LONG : SL < entry < TP requis" },
        { status: 400 },
      );
    }
    if (side === "short" && !(sl > entry && entry > tp)) {
      return Response.json(
        { error: "SHORT : SL > entry > TP requis" },
        { status: 400 },
      );
    }

    const tp1 =
      body.tp1 != null && Number(body.tp1) > 0 ? Number(body.tp1) : null;
    const tp2 =
      body.tp2 != null && Number(body.tp2) > 0 ? Number(body.tp2) : tp;

    const live = await placeBoriazLiveTrade({
      coin,
      side,
      entry,
      tp,
      sl,
      tp1,
      tp2,
      leverage,
      riskPct,
      entryMode,
      portfolioId: "boriaz",
      portfolioName: "Boriaz (manuel)",
      strategy: "smc",
      mirrorPaper: false,
    });

    if (!live.ok) {
      return Response.json(
        {
          error: live.reason || "Ordre LIVE refusé",
          skipped: live.skipped,
          ...live,
        },
        { status: 400 },
      );
    }

    noteLiveOpen(coin);
    return Response.json({
      manual: true,
      ...live,
      ok: true,
      fetchedAt: Date.now(),
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Trade live impossible" },
      { status: 400 },
    );
  }
}
