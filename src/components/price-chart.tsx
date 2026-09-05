"use client";

import { useEffect, useMemo, useState } from "react";
import { readResponseJson } from "@/lib/safe-json";

export type ChartCandle = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
};

type Marker = {
  at: number;
  price: number;
  label: string;
  tone: "entry" | "exit" | "tp" | "sl";
};

type Props = {
  coin: string;
  /** Défaut 15m */
  interval?: "15m" | "1h";
  /** Permettre le switch 15m / 1h */
  allowToggle?: boolean;
  height?: number;
  entryAt?: number | null;
  entryPx?: number | null;
  exitAt?: number | null;
  exitPx?: number | null;
  tp?: number | null;
  sl?: number | null;
  className?: string;
  /** Mode compact (cartes crypto) */
  compact?: boolean;
};

const TONE: Record<Marker["tone"], string> = {
  entry: "#38bdf8",
  exit: "#a78bfa",
  tp: "#34d399",
  sl: "#f87171",
};

export function PriceChart({
  coin,
  interval: intervalProp = "15m",
  allowToggle = false,
  height = 140,
  entryAt = null,
  entryPx = null,
  exitAt = null,
  exitPx = null,
  tp = null,
  sl = null,
  className = "",
  compact = false,
}: Props) {
  const [interval, setInterval] = useState<"15m" | "1h">(intervalProp);
  const [candles, setCandles] = useState<ChartCandle[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setInterval(intervalProp);
  }, [intervalProp]);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const pad =
          interval === "1h" ? 48 * 3600_000 : 18 * 3600_000;
        const fromBase = entryAt
          ? Math.min(entryAt - pad * 0.35, Date.now() - pad)
          : Date.now() - pad;
        const to = exitAt ? Math.max(exitAt + pad * 0.15, Date.now()) : Date.now();
        const qs = new URLSearchParams({
          coin,
          interval,
          from: String(Math.floor(fromBase)),
          to: String(Math.floor(to)),
        });
        const res = await fetch(`/api/candles?${qs}`, { cache: "no-store" });
        const json = await readResponseJson<{
          candles?: ChartCandle[];
          error?: string;
        }>(res);
        if (!alive) return;
        if (!res.ok && !json.candles?.length) {
          throw new Error(json.error || "Bougies indisponibles");
        }
        setCandles(json.candles ?? []);
      } catch (e) {
        if (alive) {
          setCandles([]);
          setError(e instanceof Error ? e.message : "Erreur graphique");
        }
      } finally {
        if (alive) setLoading(false);
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, [coin, interval, entryAt, exitAt]);

  const markers = useMemo(() => {
    const list: Marker[] = [];
    if (entryAt != null && entryPx != null && entryPx > 0) {
      list.push({ at: entryAt, price: entryPx, label: "Entrée", tone: "entry" });
    }
    if (exitAt != null && exitPx != null && exitPx > 0) {
      list.push({ at: exitAt, price: exitPx, label: "Sortie", tone: "exit" });
    }
    return list;
  }, [entryAt, entryPx, exitAt, exitPx]);

  const chart = useMemo(() => {
    if (candles.length < 2) return null;
    const w = 100;
    const h = 100;
    const padY = 8;
    const prices = candles.map((c) => c.c);
    let min = Math.min(...prices);
    let max = Math.max(...prices);
    for (const m of markers) {
      min = Math.min(min, m.price);
      max = Math.max(max, m.price);
    }
    if (tp != null && tp > 0) {
      min = Math.min(min, tp);
      max = Math.max(max, tp);
    }
    if (sl != null && sl > 0) {
      min = Math.min(min, sl);
      max = Math.max(max, sl);
    }
    const span = max - min || 1;
    const t0 = candles[0]!.t;
    const t1 = candles[candles.length - 1]!.t;
    const tSpan = Math.max(1, t1 - t0);
    const xOf = (t: number) => ((t - t0) / tSpan) * w;
    const yOf = (p: number) =>
      padY + (1 - (p - min) / span) * (h - padY * 2);
    const line = candles
      .map((c, i) => `${i === 0 ? "M" : "L"}${xOf(c.t).toFixed(2)},${yOf(c.c).toFixed(2)}`)
      .join(" ");
    const area =
      line +
      ` L${xOf(t1).toFixed(2)},${(h - 1).toFixed(2)} L${xOf(t0).toFixed(2)},${(h - 1).toFixed(2)} Z`;
    const up = candles[candles.length - 1]!.c >= candles[0]!.c;
    return { line, area, xOf, yOf, up, min, max };
  }, [candles, markers, tp, sl]);

  return (
    <div className={`w-full ${className}`}>
      {!compact ? (
        <div className="mb-1 flex items-center justify-between gap-2">
          <p className="text-[10px] tracking-wide text-muted-foreground uppercase">
            {coin} · {interval}
            {entryPx != null ? " · point d’entrée bot" : ""}
          </p>
          {allowToggle ? (
            <div className="flex gap-1">
              {(["15m", "1h"] as const).map((tf) => (
                <button
                  key={tf}
                  type="button"
                  onClick={() => setInterval(tf)}
                  className={`rounded px-1.5 py-0.5 text-[10px] ${
                    interval === tf
                      ? "bg-primary/20 text-primary"
                      : "text-muted-foreground hover:bg-white/5"
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div
        className="relative overflow-hidden rounded-lg border border-white/8 bg-background/40"
        style={{ height }}
      >
        {loading ? (
          <p className="absolute inset-0 flex items-center justify-center text-[11px] text-muted-foreground">
            Chargement…
          </p>
        ) : error ? (
          <p className="absolute inset-0 flex items-center justify-center px-2 text-center text-[11px] text-muted-foreground">
            {error}
          </p>
        ) : !chart ? (
          <p className="absolute inset-0 flex items-center justify-center text-[11px] text-muted-foreground">
            Pas assez de bougies
          </p>
        ) : (
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="h-full w-full"
            role="img"
            aria-label={`Graphique ${coin} ${interval}`}
          >
            <defs>
              <linearGradient id={`g-${coin}-${interval}`} x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor={chart.up ? "#34d399" : "#f87171"}
                  stopOpacity="0.35"
                />
                <stop
                  offset="100%"
                  stopColor={chart.up ? "#34d399" : "#f87171"}
                  stopOpacity="0"
                />
              </linearGradient>
            </defs>
            <path d={chart.area} fill={`url(#g-${coin}-${interval})`} />
            <path
              d={chart.line}
              fill="none"
              stroke={chart.up ? "#34d399" : "#f87171"}
              strokeWidth="1.2"
              vectorEffect="non-scaling-stroke"
            />
            {tp != null && tp > 0 ? (
              <line
                x1="0"
                x2="100"
                y1={chart.yOf(tp)}
                y2={chart.yOf(tp)}
                stroke={TONE.tp}
                strokeWidth="0.6"
                strokeDasharray="2 2"
                vectorEffect="non-scaling-stroke"
                opacity="0.8"
              />
            ) : null}
            {sl != null && sl > 0 ? (
              <line
                x1="0"
                x2="100"
                y1={chart.yOf(sl)}
                y2={chart.yOf(sl)}
                stroke={TONE.sl}
                strokeWidth="0.6"
                strokeDasharray="2 2"
                vectorEffect="non-scaling-stroke"
                opacity="0.8"
              />
            ) : null}
            {markers.map((m) => {
              const x = chart.xOf(m.at);
              const y = chart.yOf(m.price);
              return (
                <g key={`${m.tone}-${m.at}`}>
                  <line
                    x1={x}
                    x2={x}
                    y1="0"
                    y2="100"
                    stroke={TONE[m.tone]}
                    strokeWidth="0.7"
                    strokeDasharray="1.5 1.5"
                    vectorEffect="non-scaling-stroke"
                    opacity="0.7"
                  />
                  <circle
                    cx={x}
                    cy={y}
                    r="1.8"
                    fill={TONE[m.tone]}
                    stroke="#0b1220"
                    strokeWidth="0.5"
                  />
                </g>
              );
            })}
          </svg>
        )}
      </div>

      {!compact && markers.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
          {markers.map((m) => (
            <span key={`${m.tone}-l`} className="inline-flex items-center gap-1">
              <span
                className="inline-block size-1.5 rounded-full"
                style={{ background: TONE[m.tone] }}
              />
              {m.label}
            </span>
          ))}
          {tp != null ? (
            <span className="inline-flex items-center gap-1">
              <span className="inline-block size-1.5 rounded-full bg-long" />
              TP
            </span>
          ) : null}
          {sl != null ? (
            <span className="inline-flex items-center gap-1">
              <span className="inline-block size-1.5 rounded-full bg-short" />
              SL
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
