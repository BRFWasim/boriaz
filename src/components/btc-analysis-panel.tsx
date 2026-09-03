"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  formatExactTime,
  formatPct,
  formatPx,
  formatUsd,
  signedClass,
} from "@/lib/format";
import type { BtcAnalysisPayload } from "@/lib/types";

export function BtcAnalysisPanel() {
  const [data, setData] = useState<BtcAnalysisPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch("/api/btc-analysis", { cache: "no-store" });
      const json = (await res.json()) as BtcAnalysisPayload & { error?: string };
      if (!res.ok) throw new Error(json.error || "Analyse BTC impossible");
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur réseau");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/btc-analysis", { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        const json = (await res.json()) as BtcAnalysisPayload & { error?: string };
        if (!res.ok) throw new Error(json.error || "Analyse BTC impossible");
        return json;
      })
      .then((json) => {
        setData(json);
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Erreur réseau");
      })
      .finally(() => setLoading(false));
    const id = window.setInterval(() => void load(true), 60_000);
    return () => {
      controller.abort();
      window.clearInterval(id);
    };
  }, [load]);

  if (loading && !data) {
    return (
      <p className="animate-pulse text-sm text-muted-foreground">
        Calcul RSI / MACD / EMA sur bougies BTC 4h Hyperliquid…
      </p>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-6">
        <p className="font-medium">Analyse BTC indisponible</p>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        <Button className="mt-4" onClick={() => void load(false)}>
          Réessayer
        </Button>
      </div>
    );
  }

  if (!data) return null;

  const biasClass =
    data.bias === "haussier"
      ? "border-long/40 bg-long/10 text-long"
      : data.bias === "baissier"
        ? "border-short/40 bg-short/10 text-short"
        : "border-border text-muted-foreground";

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border/80 bg-card/70 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">BTC · analyse live</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Bougies {data.interval} (Hyperliquid) · horizon {data.horizon}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={biasClass}>
              Avis {data.bias} · score {data.score}
            </Badge>
            <Button size="sm" variant="outline" onClick={() => void load(false)} disabled={loading}>
              <RefreshCwIcon className={loading ? "animate-spin" : ""} />
              Actualiser
            </Button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          <Metric label="Prix" value={formatPx(data.indicators.price)} />
          <Metric
            label="24h"
            value={
              data.indicators.change24hPct === null
                ? "n/d"
                : formatPct(data.indicators.change24hPct, 2)
            }
            className={
              data.indicators.change24hPct === null
                ? undefined
                : signedClass(data.indicators.change24hPct)
            }
          />
          <Metric
            label="RSI14"
            value={
              data.indicators.rsi14 === null
                ? "n/d"
                : data.indicators.rsi14.toFixed(1)
            }
          />
          <Metric
            label="MACD"
            value={
              data.indicators.macd === null ? "n/d" : data.indicators.macd.toFixed(1)
            }
          />
          <Metric
            label="Signal"
            value={
              data.indicators.macdSignal === null
                ? "n/d"
                : data.indicators.macdSignal.toFixed(1)
            }
          />
          <Metric
            label="Hist"
            value={
              data.indicators.macdHist === null
                ? "n/d"
                : data.indicators.macdHist.toFixed(1)
            }
            className={
              data.indicators.macdHist === null
                ? undefined
                : signedClass(data.indicators.macdHist)
            }
          />
          <Metric
            label="EMA20"
            value={
              data.indicators.ema20 === null ? "n/d" : formatPx(data.indicators.ema20)
            }
          />
          <Metric
            label="EMA50"
            value={
              data.indicators.ema50 === null ? "n/d" : formatPx(data.indicators.ema50)
            }
          />
          <Metric
            label="EMA200"
            value={
              data.indicators.ema200 === null
                ? "n/d"
                : formatPx(data.indicators.ema200)
            }
          />
          <Metric
            label="ATR14"
            value={
              data.indicators.atr14 === null ? "n/d" : formatPx(data.indicators.atr14)
            }
          />
          <Metric
            label="Support"
            value={
              data.indicators.support === null
                ? "n/d"
                : formatPx(data.indicators.support)
            }
          />
          <Metric
            label="Résistance"
            value={
              data.indicators.resistance === null
                ? "n/d"
                : formatPx(data.indicators.resistance)
            }
          />
        </div>

        <Sparkline candles={data.candles} />

        <div className="mt-4 rounded-lg border border-border/60 bg-muted/30 p-3">
          <p className="font-medium">{data.summary}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {data.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="rounded-xl border border-border/80 bg-card/70 p-4">
        <h3 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          Avis IA complet
        </h3>
        {data.ai.enabled && data.ai.text ? (
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">
            {data.ai.text}
          </p>
        ) : (
          <div className="mt-3 rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
            <p>
              Prêt. Envoie une clé au prochain message pour activer l’analyse IA :
            </p>
            <ul className="mt-2 list-disc pl-5">
              <li>
                <code>OPENAI_API_KEY</code> (recommandé) —{" "}
                <a
                  className="text-primary underline"
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  rel="noreferrer"
                >
                  platform.openai.com/api-keys
                </a>
              </li>
              <li>
                ou <code>ANTHROPIC_API_KEY</code> —{" "}
                <a
                  className="text-primary underline"
                  href="https://console.anthropic.com/"
                  target="_blank"
                  rel="noreferrer"
                >
                  console.anthropic.com
                </a>
              </li>
            </ul>
            {data.ai.error ? (
              <p className="mt-2 text-xs">{data.ai.error}</p>
            ) : null}
          </div>
        )}
        {data.ai.provider ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Provider : {data.ai.provider}
          </p>
        ) : null}
      </section>

      <section className="rounded-xl border border-border/80 bg-card/70 p-4">
        <h3 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          Contexte hors Hyperliquid (CoinGecko)
        </h3>
        {data.external.coingecko.enabled ? (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric
              label="Market cap"
              value={
                data.external.coingecko.marketCapUsd === null
                  ? "n/d"
                  : formatUsd(data.external.coingecko.marketCapUsd)
              }
            />
            <Metric
              label="Volume 24h"
              value={
                data.external.coingecko.volume24hUsd === null
                  ? "n/d"
                  : formatUsd(data.external.coingecko.volume24hUsd)
              }
            />
            <Metric
              label="7j"
              value={
                data.external.coingecko.priceChange7dPct === null
                  ? "n/d"
                  : formatPct(data.external.coingecko.priceChange7dPct, 2)
              }
              className={
                data.external.coingecko.priceChange7dPct === null
                  ? undefined
                  : signedClass(data.external.coingecko.priceChange7dPct)
              }
            />
            <Metric
              label="30j"
              value={
                data.external.coingecko.priceChange30dPct === null
                  ? "n/d"
                  : formatPct(data.external.coingecko.priceChange30dPct, 2)
              }
              className={
                data.external.coingecko.priceChange30dPct === null
                  ? undefined
                  : signedClass(data.external.coingecko.priceChange30dPct)
              }
            />
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            CoinGecko indisponible pour le moment (rate-limit public possible).
            Clé Pro optionnelle : <code>COINGECKO_API_KEY</code>.
          </p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Maj {formatExactTime(data.fetchedAt)} · {data.disclaimer}
        </p>
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="rounded-lg bg-muted/30 px-3 py-2">
      <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p className={`numeric mt-1 text-sm font-medium ${className ?? ""}`}>
        {value}
      </p>
    </div>
  );
}

function Sparkline({
  candles,
}: {
  candles: BtcAnalysisPayload["candles"];
}) {
  if (candles.length < 2) return null;
  const closes = candles.map((c) => c.c);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const w = 640;
  const h = 120;
  const points = closes
    .map((price, index) => {
      const x = (index / (closes.length - 1)) * w;
      const y = h - ((price - min) / (max - min || 1)) * (h - 8) - 4;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-border/60 bg-background/40 p-2">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-28 w-full">
        <polyline
          fill="none"
          stroke="oklch(0.8 0.11 195)"
          strokeWidth="2"
          points={points}
        />
      </svg>
      <p className="px-1 text-[11px] text-muted-foreground">
        Dernières {candles.length} bougies 4h · min {formatPx(min)} · max{" "}
        {formatPx(max)}
      </p>
    </div>
  );
}
