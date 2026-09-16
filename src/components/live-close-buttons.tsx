"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { readResponseJson } from "@/lib/safe-json";
import type { TradeManageSnapshot } from "@/lib/user-types";

type Props = {
  coin: string;
  side: string;
  unrealizedPnlUsd?: number;
  onClosed?: () => void | Promise<void>;
  onSnapshot?: (snap: TradeManageSnapshot) => void;
};

/** Boutons clôture / demi-clôture / relecture / TP-SL d’une position LIVE HL. */
export function LiveCloseButtons({
  coin,
  side,
  unrealizedPnlUsd,
  onClosed,
  onSnapshot,
}: Props) {
  const [busy, setBusy] = useState<
    "full" | "half" | "review" | "tpsl" | null
  >(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function close(fraction: number) {
    const label = fraction >= 0.99 ? "toute" : "50 % de";
    const pnlHint =
      unrealizedPnlUsd != null
        ? ` PnL latent ~${unrealizedPnlUsd >= 0 ? "+" : ""}${(unrealizedPnlUsd * fraction).toFixed(2)} $.`
        : "";
    if (
      !window.confirm(
        `Clôturer ${label} la position ${side.toUpperCase()} ${coin} sur Hyperliquid ?${pnlHint}\n\nOrdre marché reduce-only — irréversible.`,
      )
    ) {
      return;
    }
    setBusy(fraction >= 0.99 ? "full" : "half");
    setMsg(null);
    try {
      const res = await fetch("/api/live-close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coin,
          side: side === "short" ? "short" : "long",
          fraction,
        }),
      });
      const json = await readResponseJson<{
        ok?: boolean;
        error?: string;
        sizeClosed?: string;
        pnlUsd?: number;
      }>(res);
      if (!res.ok || !json.ok) {
        setMsg(json.error || "Clôture refusée");
        return;
      }
      setMsg(
        `Clôturé ${json.sizeClosed ?? ""} · PnL ~${
          json.pnlUsd != null
            ? `${json.pnlUsd >= 0 ? "+" : ""}${json.pnlUsd.toFixed(2)} $`
            : "—"
        }`,
      );
      await onClosed?.();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Erreur clôture");
    } finally {
      setBusy(null);
    }
  }

  async function forceReview() {
    setBusy("review");
    setMsg("Relecture forcée…");
    try {
      const res = await fetch("/api/manage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coin,
          side: side === "short" ? "short" : "long",
          fast: false,
        }),
      });
      const json = await readResponseJson<{
        error?: string;
        live?: {
          reviewed?: number;
          snapshots?: Record<string, TradeManageSnapshot>;
        };
      }>(res);
      if (!res.ok) {
        setMsg(json.error || "Relecture échouée");
        return;
      }
      const key = `${coin.toUpperCase()}:${side === "short" ? "short" : "long"}`;
      const snap = json.live?.snapshots?.[key];
      if (snap) onSnapshot?.(snap);
      setMsg(
        snap
          ? `Relecture OK · ${snap.action} · ${snap.outlook?.slice(0, 80) || snap.reason?.slice(0, 80) || ""}`
          : `Relecture terminée (${json.live?.reviewed ?? 0})`,
      );
      await onClosed?.();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Erreur relecture");
    } finally {
      setBusy(null);
    }
  }

  async function forceTpsl() {
    if (
      !window.confirm(
        `Replacer les TP/SL de ${side.toUpperCase()} ${coin} sur Hyperliquid ?\n\nAnnule les triggers existants puis re-place (journal ou SL 1.5% / TP 2R).`,
      )
    ) {
      return;
    }
    setBusy("tpsl");
    setMsg("Replace TP/SL…");
    try {
      const res = await fetch("/api/live-repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coin,
          side: side === "short" ? "short" : "long",
          forceReplace: true,
        }),
      });
      const json = await readResponseJson<{
        ok?: boolean;
        error?: string;
        tp?: number;
        sl?: number;
        notes?: string[];
      }>(res);
      if (!res.ok || !json.ok) {
        setMsg(json.error || "Replace TP/SL refusé");
        return;
      }
      setMsg(
        `TP/SL re-placés${json.sl != null ? ` SL ${json.sl}` : ""}${
          json.tp != null ? ` / TP ${json.tp}` : ""
        }`,
      );
      await onClosed?.();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Erreur TP/SL");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7"
        disabled={busy != null}
        onClick={() => void forceReview()}
      >
        {busy === "review" ? "Relecture…" : "Forcer relecture"}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 border-amber-500/40 text-amber-800 dark:text-amber-300"
        disabled={busy != null}
        onClick={() => void forceTpsl()}
      >
        {busy === "tpsl" ? "TP/SL…" : "Replacer TP/SL"}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 border-rose-500/40 text-rose-700 hover:bg-rose-500/10 dark:text-rose-300"
        disabled={busy != null}
        onClick={() => void close(1)}
      >
        {busy === "full" ? "Clôture…" : "Clôturer LIVE"}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7"
        disabled={busy != null}
        onClick={() => void close(0.5)}
      >
        {busy === "half" ? "½…" : "Clôturer 50 %"}
      </Button>
      {msg ? (
        <span className="text-[10px] text-muted-foreground">{msg}</span>
      ) : null}
    </div>
  );
}
