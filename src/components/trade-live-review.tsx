"use client";

import type { PaperTrade, TradeManageSnapshot } from "@/lib/user-types";
import { formatParisDateTime } from "@/lib/format";

function actionLabel(a: TradeManageSnapshot["action"]): string {
  switch (a) {
    case "close":
      return "Clôturer";
    case "flip":
      return "Basculer";
    case "wait":
      return "Attendre";
    default:
      return "Laisser courir";
  }
}

function actionClass(a: TradeManageSnapshot["action"]): string {
  switch (a) {
    case "close":
      return "text-short border-short/40 bg-short/10";
    case "flip":
      return "text-amber-700 border-amber-500/40 bg-amber-500/10 dark:text-amber-300";
    case "wait":
      return "text-amber-800 border-amber-400/30 bg-amber-400/5 dark:text-amber-200";
    default:
      return "text-long border-long/30 bg-long/10";
  }
}

/** Bloc analyse live sous chaque trade ouvert. */
export function TradeLiveReview({ trade: t }: { trade: PaperTrade }) {
  const s = t.manageSnapshot;
  if (!s && t.status !== "open" && t.status !== "pending") return null;
  if (!s) {
    return (
      <div className="mt-2 rounded-lg border border-dashed border-white/10 bg-muted/10 px-2.5 py-2 text-[11px] text-muted-foreground">
        Relecture en cours… PnL et structure seront publiés ici dès le prochain
        scan (~1 min).
      </div>
    );
  }

  const ageSec = Math.max(0, Math.round((Date.now() - s.at) / 1000));
  const ageLabel =
    ageSec < 60 ? `${ageSec}s` : `${Math.round(ageSec / 60)} min`;

  return (
    <div className="mt-2 space-y-1.5 rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-2 text-[11px]">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <p className="font-medium text-foreground">
          Analyse live · maj il y a {ageLabel}
        </p>
        <span
          className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${actionClass(s.action)}`}
        >
          {actionLabel(s.action)}
        </span>
      </div>
      <p className="text-foreground/90">{s.outlook || s.reason}</p>
      <p className="numeric text-muted-foreground">
        Spot {s.price} · PnL{" "}
        <span className={s.pnlEur >= 0 ? "text-long" : "text-short"}>
          {s.pnlEur >= 0 ? "+" : ""}
          {s.pnlEur.toFixed(2)} € ({s.pnlPct >= 0 ? "+" : ""}
          {s.pnlPct.toFixed(2)}%)
        </span>
        {" · "}1h {s.bias1h} / 4h {s.bias4h}
        {s.support != null ? ` · S ${s.support}` : ""}
        {s.resistance != null ? ` · R ${s.resistance}` : ""}
      </p>
      <p className="text-[10px] text-muted-foreground/80">
        {s.reason}
        {" · "}
        {formatParisDateTime(s.at)} · {s.providers.join("+")}
      </p>
    </div>
  );
}
