"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { readResponseJson } from "@/lib/safe-json";

type Props = {
  coin: string;
  side: string;
  unrealizedPnlUsd?: number;
  onClosed?: () => void | Promise<void>;
};

/** Boutons clôture / demi-clôture d’une position LIVE HL. */
export function LiveCloseButtons({
  coin,
  side,
  unrealizedPnlUsd,
  onClosed,
}: Props) {
  const [busy, setBusy] = useState<"full" | "half" | null>(null);
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

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
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
