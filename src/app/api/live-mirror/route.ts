import { bindUserRequest } from "@/lib/bind-request";
import { postInfo } from "@/lib/hyperliquid";
import { parseNum } from "@/lib/format";
import {
  loadPaperTrades,
  loadPrefs,
  persistUserId,
  savePaperTrades,
  setPersistUser,
  type PaperTrade,
} from "@/lib/persist";
import { isLiveEnvReady } from "@/lib/hl-live";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

async function findPaperForMirror(paperId: string): Promise<{
  trade: PaperTrade;
  trades: PaperTrade[];
  scope: string;
} | null> {
  const scope = persistUserId();
  const trades = await loadPaperTrades();
  const local = trades.find((x) => x.id === paperId);
  if (local) return { trade: local, trades, scope };

  // Bot cron écrit souvent sous le scope « default » — on cherche aussi là.
  if (scope === "default") return null;
  try {
    setPersistUser("default");
    const defTrades = await loadPaperTrades();
    const t = defTrades.find((x) => x.id === paperId);
    if (t) return { trade: t, trades: defTrades, scope: "default" };
  } finally {
    setPersistUser(scope);
  }
  return null;
}

/**
 * Copie manuelle d’un paper Boriaz → LIVE HL au prix marché actuel.
 * Si le setup n’est plus valide (prix déjà hors SL/TP), refuse.
 */
export async function POST(request: Request) {
  try {
    await bindUserRequest();
    const body = (await request.json()) as { paperId?: string };
    const paperId = String(body.paperId || "").trim();
    if (!paperId) {
      return Response.json({ error: "paperId requis" }, { status: 400 });
    }

    const ready = isLiveEnvReady();
    if (!ready.ok) {
      return Response.json(
        { error: ready.reason || "LIVE HL non prêt (env)" },
        { status: 400 },
      );
    }

    const prefs = await loadPrefs();
    const found = await findPaperForMirror(paperId);
    if (!found) {
      return Response.json({ error: "Paper introuvable" }, { status: 404 });
    }
    const { trade: t, trades, scope: paperScope } = found;
    if (t.portfolioId !== "boriaz") {
      return Response.json(
        { error: "Copie LIVE réservée au paper Boriaz uniquement" },
        { status: 400 },
      );
    }
    if (t.status !== "open" && t.status !== "pending") {
      return Response.json(
        { error: "Ce paper n’est plus ouvert / pending" },
        { status: 400 },
      );
    }
    if (/LIVE HL/i.test(t.note || "")) {
      return Response.json(
        { error: "Ce paper a déjà un LIVE HL associé" },
        { status: 400 },
      );
    }

    const mids = (await postInfo({ type: "allMids" })) as Record<
      string,
      string
    >;
    const mid = parseNum(
      mids[t.coin] ??
        mids[t.coin.toUpperCase()] ??
        mids[t.coin.toLowerCase()] ??
        "0",
    );
    if (!(mid > 0)) {
      return Response.json(
        { error: `Prix marché ${t.coin} indisponible` },
        { status: 400 },
      );
    }

    // Fenêtre SL/TP encore valide au mid (epsilon relatif pour float HL)
    const eps = Math.max(mid * 1e-6, 1e-8);
    const stillOk =
      t.side === "long"
        ? mid > t.sl + eps && mid < t.tp - eps
        : mid < t.sl - eps && mid > t.tp + eps;
    if (!stillOk) {
      return Response.json(
        {
          error: `Plus possible au marché ${mid} (hors fenêtre SL ${t.sl} / TP ${t.tp})`,
          mid,
        },
        { status: 400 },
      );
    }

    const boriaz = prefs.portfolios.find((p) => p.id === "boriaz");
    const { placeBoriazLiveTradeMirrored } = await import("@/lib/hl-live");
    const live = await placeBoriazLiveTradeMirrored({
      coin: t.coin,
      side: t.side,
      entry: mid,
      tp: t.tp,
      sl: t.sl,
      tp1: t.tp1,
      tp2: t.tp2 ?? t.tp,
      leverage: t.leverage,
      riskPct: boriaz?.riskPct ?? 2,
      entryMode: "market_now",
      paperId: t.id,
      portfolioId: "boriaz",
      portfolioName: t.portfolioName || "Boriaz",
      strategy: "smc",
      paperMarginEur: t.marginEur,
      paperBankrollEur: boriaz?.bankrollEur ?? prefs.paperBankrollEur ?? 1000,
      mirrorPaper: true,
    });

    if (!live.ok) {
      return Response.json(
        {
          error: live.reason || "LIVE échoué",
          skipped: live.skipped ?? false,
          mid,
        },
        { status: live.skipped ? 409 : 500 },
      );
    }

    const bot = live.botLabel || "Boriaz";
    const tpTxt =
      live.tpPnlUsd != null
        ? ` · si TP ${live.tpPnlUsd >= 0 ? "+" : ""}${live.tpPnlUsd.toFixed(2)}$`
        : "";
    const slTxt =
      live.slPnlUsd != null
        ? ` · si SL ${live.slPnlUsd >= 0 ? "+" : ""}${live.slPnlUsd.toFixed(2)}$`
        : "";
    t.note = `${t.note || "SMC"} · LIVE HL manuel @ mid ${mid} [${bot}] size=${live.size} entryOid=${live.entryOid ?? "?"}${tpTxt}${slTxt}`;
    t.markPx = mid;

    const userScope = persistUserId();
    try {
      setPersistUser(paperScope);
      await savePaperTrades(trades);
    } finally {
      setPersistUser(userScope);
    }

    // Propage la note sur le paper du user courant si l’id existe aussi chez lui.
    if (paperScope !== userScope) {
      const userTrades = await loadPaperTrades();
      const ut = userTrades.find((x) => x.id === paperId);
      if (ut) {
        ut.note = t.note;
        ut.markPx = mid;
        await savePaperTrades(userTrades);
      }
    }

    return Response.json({
      ok: true,
      mid,
      live: {
        size: live.size,
        entryOid: live.entryOid,
        tpOid: live.tpOid,
        slOid: live.slOid,
        botLabel: bot,
        tpPnlUsd: live.tpPnlUsd,
        slPnlUsd: live.slPnlUsd,
        reason: live.reason,
      },
      trade: t,
    });
  } catch (e) {
    console.error("live-mirror POST", e);
    return Response.json(
      { error: e instanceof Error ? e.message : "Erreur copie LIVE" },
      { status: 500 },
    );
  }
}
