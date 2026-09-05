"use client";

import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { readResponseJson } from "@/lib/safe-json";
import { formatPx } from "@/lib/format";

export type ChartCandle = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
};

type Props = {
  coin: string;
  /** Default 15m */
  interval?: "15m" | "1h";
  /** Toggle 15m / 1h */
  allowToggle?: boolean;
  height?: number;
  /** long => TP above / SL below (inverted for short) */
  side?: "long" | "short" | null;
  entryAt?: number | null;
  entryPx?: number | null;
  exitAt?: number | null;
  exitPx?: number | null;
  tp?: number | null;
  sl?: number | null;
  className?: string;
  compact?: boolean;
};

type ZoneBox = {
  top: number;
  height: number;
  left: number;
  width: number;
  tone: "tp" | "sl";
};

type TradeSnapshot = {
  side: "long" | "short" | null;
  entryAt: number | null;
  entryPx: number | null;
  exitAt: number | null;
  exitPx: number | null;
  tp: number | null;
  sl: number | null;
};

function toUtcSec(ms: number): UTCTimestamp {
  return Math.floor(ms / 1000) as UTCTimestamp;
}

function isLongSide(
  side: "long" | "short" | null | undefined,
  entry: number,
  tp: number | null | undefined,
  sl: number | null | undefined,
): boolean {
  if (side === "long") return true;
  if (side === "short") return false;
  if (tp != null && tp > 0 && entry > 0) return tp > entry;
  if (sl != null && sl > 0 && entry > 0) return sl < entry;
  return true;
}

export function PriceChart({
  coin,
  interval: intervalProp = "15m",
  allowToggle = false,
  height = 160,
  side = null,
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
  const [zones, setZones] = useState<ZoneBox[]>([]);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const paintRef = useRef<(() => void) | null>(null);
  const tradeRef = useRef<TradeSnapshot>({
    side,
    entryAt,
    entryPx,
    exitAt,
    exitPx,
    tp,
    sl,
  });
  tradeRef.current = { side, entryAt, entryPx, exitAt, exitPx, tp, sl };

  useEffect(() => {
    setInterval(intervalProp);
  }, [intervalProp]);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const pad = interval === "1h" ? 48 * 3600_000 : 18 * 3600_000;
        const fromBase = entryAt
          ? Math.min(entryAt - pad * 0.35, Date.now() - pad)
          : Date.now() - pad;
        const to = exitAt
          ? Math.max(exitAt + pad * 0.15, Date.now())
          : Date.now();
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

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const chart = createChart(el, {
      width: el.clientWidth || 320,
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "rgba(148, 163, 184, 0.9)",
        fontSize: compact ? 9 : 10,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(148, 163, 184, 0.12)" },
        horzLines: { color: "rgba(148, 163, 184, 0.12)" },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { color: "rgba(148, 163, 184, 0.35)", width: 1 },
        horzLine: { color: "rgba(148, 163, 184, 0.35)", width: 1 },
      },
      handleScroll: !compact,
      handleScale: !compact,
    });

    const series = chart.addSeries(CandlestickSeries, {
      // Style proche TradingView mobile : haussière bleue, baissière sombre
      upColor: "#3b82f6",
      downColor: "#0f172a",
      borderVisible: true,
      borderUpColor: "#60a5fa",
      borderDownColor: "#cbd5e1",
      wickUpColor: "#60a5fa",
      wickDownColor: "#e2e8f0",
    });

    chartRef.current = chart;
    seriesRef.current = series;
    markersRef.current = createSeriesMarkers(series, []);

    const paintZones = () => {
      const c = chartRef.current;
      const s = seriesRef.current;
      const host = wrapRef.current;
      const tr = tradeRef.current;
      if (!c || !s || !host || tr.entryPx == null || tr.entryPx <= 0) {
        setZones([]);
        return;
      }

      const yEntry = s.priceToCoordinate(tr.entryPx);
      if (yEntry == null) {
        setZones([]);
        return;
      }

      const long = isLongSide(tr.side, tr.entryPx, tr.tp, tr.sl);
      const ts = c.timeScale();
      const xStart =
        tr.entryAt != null
          ? (ts.timeToCoordinate(toUtcSec(tr.entryAt)) ?? 0)
          : 0;
      const xEnd =
        tr.exitAt != null
          ? (ts.timeToCoordinate(toUtcSec(tr.exitAt)) ?? host.clientWidth)
          : host.clientWidth;
      const left = Math.max(0, Math.min(xStart, xEnd));
      const width = Math.max(10, Math.abs(xEnd - xStart));
      const next: ZoneBox[] = [];

      if (tr.tp != null && tr.tp > 0) {
        const ok = long ? tr.tp > tr.entryPx : tr.tp < tr.entryPx;
        const yTp = s.priceToCoordinate(tr.tp);
        if (ok && yTp != null) {
          next.push({
            top: Math.min(yEntry, yTp),
            height: Math.max(2, Math.abs(yTp - yEntry)),
            left,
            width,
            tone: "tp",
          });
        }
      }

      if (tr.sl != null && tr.sl > 0) {
        const ok = long ? tr.sl < tr.entryPx : tr.sl > tr.entryPx;
        const ySl = s.priceToCoordinate(tr.sl);
        if (ok && ySl != null) {
          next.push({
            top: Math.min(yEntry, ySl),
            height: Math.max(2, Math.abs(ySl - yEntry)),
            left,
            width,
            tone: "sl",
          });
        }
      }

      setZones(next);
    };

    paintRef.current = paintZones;

    const ro = new ResizeObserver(() => {
      if (!wrapRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({ width: wrapRef.current.clientWidth });
      paintZones();
    });
    ro.observe(el);
    chart.timeScale().subscribeVisibleLogicalRangeChange(paintZones);

    return () => {
      ro.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(paintZones);
      paintRef.current = null;
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      markersRef.current = null;
      linesRef.current = [];
    };
  }, [height, compact]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;

    const clearLines = () => {
      for (const line of linesRef.current) {
        try {
          series.removePriceLine(line);
        } catch {
          /* ignore */
        }
      }
      linesRef.current = [];
    };

    if (candles.length < 2) {
      series.setData([]);
      clearLines();
      markersRef.current?.setMarkers([]);
      setZones([]);
      return;
    }

    // Trop de bougies sur un petit canvas = trait continu illisible.
    // On garde les dernières pour voir clairement le corps des bougies.
    const maxBars = compact ? 48 : 96;
    const visible = candles.length > maxBars ? candles.slice(-maxBars) : candles;
    series.setData(
      visible.map((c) => ({
        time: toUtcSec(c.t),
        open: c.o,
        high: c.h,
        low: c.l,
        close: c.c,
      })),
    );
    chart.timeScale().applyOptions({
      barSpacing: compact ? 5 : 7,
      minBarSpacing: compact ? 3 : 4,
    });
    chart.timeScale().fitContent();

    clearLines();
    if (entryPx != null && entryPx > 0) {
      linesRef.current.push(
        series.createPriceLine({
          price: entryPx,
          color: "#94a3b8",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: "Entrée",
        }),
      );
    }
    if (tp != null && tp > 0) {
      linesRef.current.push(
        series.createPriceLine({
          price: tp,
          color: "#22c55e",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: "TP",
        }),
      );
    }
    if (sl != null && sl > 0) {
      linesRef.current.push(
        series.createPriceLine({
          price: sl,
          color: "#ef4444",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: "SL",
        }),
      );
    }
    if (exitPx != null && exitPx > 0) {
      linesRef.current.push(
        series.createPriceLine({
          price: exitPx,
          color: "#a78bfa",
          lineWidth: 1,
          lineStyle: LineStyle.Solid,
          axisLabelVisible: true,
          title: "Sortie",
        }),
      );
    }

    const markers: {
      time: UTCTimestamp;
      position: "belowBar" | "aboveBar";
      color: string;
      shape: "arrowUp" | "arrowDown" | "circle";
      text: string;
    }[] = [];

    if (entryAt != null && entryPx != null && entryPx > 0) {
      const long = isLongSide(side, entryPx, tp, sl);
      markers.push({
        time: toUtcSec(entryAt),
        position: long ? "belowBar" : "aboveBar",
        color: "#38bdf8",
        shape: long ? "arrowUp" : "arrowDown",
        text: "Entrée",
      });
    }
    if (exitAt != null && exitPx != null && exitPx > 0) {
      markers.push({
        time: toUtcSec(exitAt),
        position: "aboveBar",
        color: "#a78bfa",
        shape: "circle",
        text: "Sortie",
      });
    }
    markersRef.current?.setMarkers(markers);

    requestAnimationFrame(() => {
      paintRef.current?.();
    });
  }, [candles, entryAt, entryPx, exitAt, exitPx, tp, sl, side, compact]);

  const longHint =
    entryPx != null ? isLongSide(side, entryPx, tp, sl) : true;

  return (
    <div className={`w-full ${className}`}>
      {!compact ? (
        <div className="mb-1 flex items-center justify-between gap-2">
          <p className="text-[10px] tracking-wide text-muted-foreground uppercase">
            {coin} · {interval} · bougies
            {entryPx != null ? " · setup trade" : ""}
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
        className="relative overflow-hidden rounded-lg border border-white/8 bg-[#0b1220]/70"
        style={{ height }}
      >
        <div ref={wrapRef} className="absolute inset-0" />

        {zones.map((z, i) => (
          <div
            key={`${z.tone}-${i}`}
            className="pointer-events-none absolute z-[1]"
            style={{
              top: z.top,
              left: z.left,
              width: z.width,
              height: z.height,
              background:
                z.tone === "tp"
                  ? "rgba(34, 197, 94, 0.22)"
                  : "rgba(239, 68, 68, 0.22)",
              borderTop:
                z.tone === "tp"
                  ? "1px solid rgba(34, 197, 94, 0.65)"
                  : undefined,
              borderBottom:
                z.tone === "sl"
                  ? "1px solid rgba(239, 68, 68, 0.65)"
                  : undefined,
            }}
          />
        ))}

        {loading ? (
          <p className="pointer-events-none absolute inset-0 z-[2] flex items-center justify-center text-[11px] text-muted-foreground">
            Chargement…
          </p>
        ) : null}
        {error ? (
          <p className="pointer-events-none absolute inset-0 z-[2] flex items-center justify-center px-2 text-center text-[11px] text-muted-foreground">
            {error}
          </p>
        ) : null}
        {!loading && !error && candles.length < 2 ? (
          <p className="pointer-events-none absolute inset-0 z-[2] flex items-center justify-center text-[11px] text-muted-foreground">
            Pas assez de bougies
          </p>
        ) : null}
      </div>

      {!compact && entryPx != null && entryPx > 0 ? (
        <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block size-1.5 rounded-full bg-sky-400" />
            Entrée {formatPx(entryPx)}
            {side
              ? ` · ${side.toUpperCase()}`
              : longHint
                ? " · LONG"
                : " · SHORT"}
          </span>
          {tp != null && tp > 0 ? (
            <span className="inline-flex items-center gap-1 text-long">
              <span className="inline-block size-1.5 rounded-full bg-long" />
              TP {formatPx(tp)}
            </span>
          ) : null}
          {sl != null && sl > 0 ? (
            <span className="inline-flex items-center gap-1 text-short">
              <span className="inline-block size-1.5 rounded-full bg-short" />
              SL {formatPx(sl)}
            </span>
          ) : null}
          {exitPx != null && exitPx > 0 ? (
            <span className="inline-flex items-center gap-1">
              <span className="inline-block size-1.5 rounded-full bg-violet-400" />
              Sortie {formatPx(exitPx)}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
