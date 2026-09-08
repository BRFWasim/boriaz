"use client";

import type { TradeManageSnapshot } from "@/lib/user-types";
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

type Props = {
  snapshot?: TradeManageSnapshot | null;
  /** Affiche le placeholder « relecture en cours » si pas encore de snapshot. */
  pending?: boolean;
  /** Unité du PnL snapshot (paper = €, live = $). */
  currency?: "€" | "$";
};

/** Bloc analyse live sous chaque trade / position ouverte (long ET short). */
export function TradeLiveReview({
  snapshot: s,
  pending = false,
  currency = "€",
}: Props) {
  if (!s && !pending) return null;
  if (!s) {
    return (
      <div className="mt-2 rounded-lg border border-dashed border-white/10 bg-muted/10 px-2.5 py-2 text-[11px] text-muted-foreground">
        Relecture en cours… PnL et structure (long/short) seront publiés ici dès
        le prochain scan (~1 min).
      </div>
    );
  }

  const ageSec = Math.max(0, Math.round((Date.now() - s.at) / 1000));
  const ageLabel =
    ageSec < 60 ? `${ageSec}s` : `${Math.round(ageSec / 60)} min`;
  const cur = s.currency ?? currency;
  const bullets = s.bullets?.length ? s.bullets : null;

  return (
    <div className="mt-2 space-y-1.5 rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-2 text-[11px]">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <p className="font-medium text-foreground">
          Analyse live
          {s.side ? ` · ${s.side.toUpperCase()}` : ""} · maj il y a {ageLabel}
        </p>
        <span
          className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${actionClass(s.action)}`}
        >
          {actionLabel(s.action)}
        </span>
      </div>
      <p className="text-foreground/90">{s.outlook || s.reason}</p>
      {bullets ? (
        <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
          {bullets.map((b) => (
            <li key={b.slice(0, 48)}>{b}</li>
          ))}
        </ul>
      ) : null}
      <p className="numeric text-muted-foreground">
        Spot {s.price} · PnL{" "}
        <span className={s.pnlEur >= 0 ? "text-long" : "text-short"}>
          {s.pnlEur >= 0 ? "+" : ""}
          {s.pnlEur.toFixed(2)} {cur} ({s.pnlPct >= 0 ? "+" : ""}
          {s.pnlPct.toFixed(2)}%)
        </span>
        {" · "}
        {s.bias15m ? `15m ${s.bias15m} / ` : ""}
        1h {s.bias1h} / 4h {s.bias4h}
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

/** Raccourci paper : lit `trade.manageSnapshot`. */
export function PaperTradeLiveReview({
  trade,
}: {
  trade: { status: string; manageSnapshot?: TradeManageSnapshot | null };
}) {
  const open = trade.status === "open" || trade.status === "pending";
  if (!open && !trade.manageSnapshot) return null;
  return (
    <TradeLiveReview
      snapshot={trade.manageSnapshot}
      pending={open && !trade.manageSnapshot}
      currency="€"
    />
  );
}
