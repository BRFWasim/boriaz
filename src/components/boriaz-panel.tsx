"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { signedClass } from "@/lib/format";
import { readResponseJson } from "@/lib/safe-json";
import { TradeLiveReview } from "@/components/trade-live-review";
import { LiveCloseButtons } from "@/components/live-close-buttons";
import type { TradeManageSnapshot } from "@/lib/user-types";

type LivePosition = {
  coin: string;
  side: string;
  size: number;
  unrealizedPnlUsd: number;
  leverage: number;
  entryPx?: number;
  botLabel?: string | null;
  portfolioName?: string | null;
  tp?: number | null;
  sl?: number | null;
  tpPnlUsd?: number | null;
  slPnlUsd?: number | null;
  riskUsd?: number | null;
  nakedTpsl?: boolean;
  journalMissing?: boolean;
  tpslSource?: string | null;
  manageSnapshot?: TradeManageSnapshot | null;
};

type LiveHl = {
  ok: boolean;
  reason?: string;
  accountValueUsd: number;
  totalMarginUsedUsd: number;
  withdrawableUsd: number;
  totalUnrealizedPnlUsd: number;
  openPositionCount: number;
  address: string | null;
  agentAddress: string | null;
  accountAddress: string | null;
  ready: boolean;
  riskUsd: number | null;
  positions: LivePosition[];
};

function Stat({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-card/40 px-3 py-2">
      <p className="text-[10px] tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p className={`mt-1 text-sm font-semibold numeric ${className ?? ""}`}>
        {value}
      </p>
    </div>
  );
}

/** Onglet privé — wallet Hyperliquid réel (après login). */
export function BoriazPanel({ onOpenLab }: { onOpenLab?: () => void }) {
  const [liveHl, setLiveHl] = useState<LiveHl | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const lr = await fetch("/api/live-account", { cache: "no-store" });
      const lj = await readResponseJson<{
        error?: string;
        env?: {
          ready?: boolean;
          agentAddress?: string | null;
          accountAddress?: string | null;
        };
        portfolio?: {
          ok: boolean;
          reason?: string;
          accountValueUsd: number;
          totalMarginUsedUsd: number;
          withdrawableUsd: number;
          totalUnrealizedPnlUsd: number;
          openPositionCount: number;
          address: string | null;
          positions?: LivePosition[];
        };
        riskPreview?: { riskUsd?: number } | null;
      }>(lr);
      if (!lr.ok) {
        setError(lj.error || "Wallet réel inaccessible — reconnecte-toi.");
        setLiveHl(null);
        return;
      }
      if (lj.portfolio) {
        setLiveHl({
          ok: lj.portfolio.ok,
          reason: lj.portfolio.reason,
          accountValueUsd: lj.portfolio.accountValueUsd ?? 0,
          totalMarginUsedUsd: lj.portfolio.totalMarginUsedUsd ?? 0,
          withdrawableUsd: lj.portfolio.withdrawableUsd ?? 0,
          totalUnrealizedPnlUsd: lj.portfolio.totalUnrealizedPnlUsd ?? 0,
          openPositionCount: lj.portfolio.openPositionCount ?? 0,
          address: lj.portfolio.address,
          agentAddress: lj.env?.agentAddress ?? null,
          accountAddress: lj.env?.accountAddress ?? null,
          ready: Boolean(lj.env?.ready),
          riskUsd: lj.riskPreview?.riskUsd ?? null,
          positions: lj.portfolio.positions ?? [],
        });
        setError(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur wallet");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 20_000);

    async function reviewLiveFast() {
      try {
        await fetch("/api/manage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fast: true }),
        });
        await load();
      } catch {
        /* ignore */
      }
    }
    const reviewSoon = window.setTimeout(() => void reviewLiveFast(), 8_000);
    const reviewId = window.setInterval(() => void reviewLiveFast(), 45_000);

    return () => {
      window.clearInterval(id);
      window.clearTimeout(reviewSoon);
      window.clearInterval(reviewId);
    };
  }, [load]);

  return (
    <div className="space-y-4">
      <section className="rounded-[1.5rem] border border-emerald-500/35 bg-emerald-500/5 px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[0.65rem] tracking-[0.28em] text-emerald-600 uppercase dark:text-emerald-400">
              Boriaz · Hyperliquid réel
            </p>
            <h2 className="font-heading mt-1 text-lg font-semibold">
              Wallet live
            </h2>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Solde master HL. Le bot live risque 2% de ce montant (pas du
              paper). Visible uniquement après login.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7"
              onClick={() => void load()}
            >
              Rafraîchir
            </Button>
            {onOpenLab ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7"
                onClick={onOpenLab}
              >
                Lab
              </Button>
            ) : null}
          </div>
        </div>

        {loading && !liveHl ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Chargement du wallet HL…
          </p>
        ) : null}
        {error ? (
          <p className="mt-3 text-sm text-rose-400">{error}</p>
        ) : null}

        {liveHl ? (
          liveHl.ok && liveHl.accountValueUsd > 0 ? (
            <>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <Stat
                  label="Account value"
                  value={`${liveHl.accountValueUsd.toFixed(2)} $`}
                />
                <Stat
                  label="Marge utilisée"
                  value={`${liveHl.totalMarginUsedUsd.toFixed(2)} $`}
                />
                <Stat
                  label="Withdrawable"
                  value={`${liveHl.withdrawableUsd.toFixed(2)} $`}
                />
                <Stat
                  label="PnL latent"
                  value={`${liveHl.totalUnrealizedPnlUsd >= 0 ? "+" : ""}${liveHl.totalUnrealizedPnlUsd.toFixed(2)} $`}
                  className={signedClass(liveHl.totalUnrealizedPnlUsd)}
                />
                <Stat
                  label="Risque 2% / trade"
                  value={`${(liveHl.riskUsd ?? liveHl.accountValueUsd * 0.02).toFixed(2)} $`}
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {liveHl.openPositionCount} position
                {liveHl.openPositionCount !== 1 ? "s" : ""} ouverte
                {liveHl.openPositionCount !== 1 ? "s" : ""}
                {liveHl.accountAddress
                  ? ` · master ${liveHl.accountAddress.slice(0, 6)}…${liveHl.accountAddress.slice(-4)}`
                  : ""}
                {liveHl.agentAddress
                  ? ` · agent ${liveHl.agentAddress.slice(0, 6)}…${liveHl.agentAddress.slice(-4)}`
                  : ""}
              </p>
              {liveHl.positions.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {liveHl.positions.map((p) => (
                    <li
                      key={`${p.coin}-${p.side}`}
                      className="rounded-xl border border-border/60 bg-card/50 px-3 py-2 text-sm"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">
                          {p.coin} {p.side} {p.leverage}×
                          {p.botLabel ? (
                            <span className="ml-2 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-700 uppercase dark:text-emerald-300">
                              {p.botLabel}
                            </span>
                          ) : (
                            <span className="ml-2 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-700 uppercase dark:text-emerald-300">
                              Boriaz
                            </span>
                          )}
                          {p.nakedTpsl ? (
                            <span className="ml-2 rounded border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 dark:text-rose-300">
                              sans TP/SL HL
                            </span>
                          ) : null}
                          {p.journalMissing ? (
                            <span className="ml-2 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-300">
                              journal manquant
                            </span>
                          ) : null}
                        </span>
                        <span className={signedClass(p.unrealizedPnlUsd)}>
                          {p.unrealizedPnlUsd >= 0 ? "+" : ""}
                          {p.unrealizedPnlUsd.toFixed(2)} $
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {p.entryPx != null ? `entry ${p.entryPx} · ` : ""}
                        size {p.size}
                        {p.tp != null ? ` · TP ${p.tp}` : " · TP —"}
                        {p.sl != null ? ` · SL ${p.sl}` : " · SL —"}
                        {p.tpslSource ? ` · src ${p.tpslSource}` : ""}
                      </p>
                      {p.nakedTpsl ? (
                        <p className="mt-0.5 text-[11px] text-rose-700 dark:text-rose-300">
                          Aucun TP/SL trigger sur Hyperliquid — protection
                          manquante (Boriaz tentera une réparation au prochain
                          cron).
                        </p>
                      ) : null}
                      {p.journalMissing ? (
                        <p className="mt-0.5 text-[11px] text-amber-800 dark:text-amber-300">
                          Position wallet rattachée à Boriaz (seul bot LIVE) —
                          métadonnées journal absentes (pas un autre bot).
                        </p>
                      ) : null}
                      <p className="mt-0.5 text-xs">
                        <span className="text-emerald-700 dark:text-emerald-400">
                          Si TP{" "}
                          {p.tpPnlUsd != null
                            ? `${p.tpPnlUsd >= 0 ? "+" : ""}${p.tpPnlUsd.toFixed(2)} $`
                            : "—"}
                        </span>
                        {" · "}
                        <span className="text-rose-700 dark:text-rose-400">
                          Si SL{" "}
                          {p.slPnlUsd != null
                            ? `${p.slPnlUsd >= 0 ? "+" : ""}${p.slPnlUsd.toFixed(2)} $`
                            : "—"}
                        </span>
                      </p>
                      <TradeLiveReview
                        snapshot={p.manageSnapshot}
                        pending={!p.manageSnapshot}
                        currency="$"
                      />
                      <LiveCloseButtons
                        coin={p.coin}
                        side={p.side}
                        unrealizedPnlUsd={p.unrealizedPnlUsd}
                        onClosed={() => void load()}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  Aucune position ouverte pour le moment.
                </p>
              )}
            </>
          ) : (
            <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-muted-foreground">
              <p className="font-medium text-amber-800 dark:text-amber-300">
                Solde réel non lu (0$)
              </p>
              <p className="mt-1">
                {liveHl.reason ||
                  "Vérifie HL_ACCOUNT_ADDRESS = master (pas l’agent) sur Vercel."}
              </p>
            </div>
          )
        ) : null}
      </section>
    </div>
  );
}
