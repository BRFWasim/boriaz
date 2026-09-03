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
import type { BtcAnalysisPayload, BuyZone, TimeframeFrame } from "@/lib/types";

export function BtcAnalysisPanel() {
  const [data, setData] = useState<BtcAnalysisPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [tgMsg, setTgMsg] = useState<string | null>(null);
  const [tgBusy, setTgBusy] = useState(false);

  const load = useCallback(async (opts?: { silent?: boolean; ai?: boolean }) => {
    const silent = opts?.silent === true;
    const ai = opts?.ai === true;
    if (!silent) setLoading(true);
    if (ai) setAiLoading(true);
    try {
      const qs = ai ? "?ai=1&force=1" : "";
      const res = await fetch(`/api/btc-analysis${qs}`, { cache: "no-store" });
      const json = (await res.json()) as BtcAnalysisPayload & { error?: string };
      if (!res.ok) throw new Error(json.error || "Analyse impossible");
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur réseau");
    } finally {
      setLoading(false);
      setAiLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/btc-analysis", { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        const json = (await res.json()) as BtcAnalysisPayload & { error?: string };
        if (!res.ok) throw new Error(json.error || "Analyse impossible");
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
    // Refresh technique toutes les 90s SANS IA (0 token)
    const id = window.setInterval(() => void load({ silent: true }), 90_000);
    return () => {
      controller.abort();
      window.clearInterval(id);
    };
  }, [load]);

  async function linkTelegram() {
    setTgBusy(true);
    setTgMsg(null);
    try {
      const res = await fetch("/api/telegram/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "link" }),
      });
      const json = (await res.json()) as {
        chatId: string | null;
        detail: string;
      };
      setTgMsg(json.detail);
      await load({ silent: true });
    } catch (err) {
      setTgMsg(err instanceof Error ? err.message : "Échec liaison Telegram");
    } finally {
      setTgBusy(false);
    }
  }

  async function testTelegram() {
    setTgBusy(true);
    setTgMsg(null);
    try {
      const res = await fetch("/api/telegram/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test" }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      setTgMsg(json.ok ? "Message test envoyé ✅" : json.error || "Échec test");
    } catch (err) {
      setTgMsg(err instanceof Error ? err.message : "Échec test");
    } finally {
      setTgBusy(false);
    }
  }

  async function forceDigest() {
    setTgBusy(true);
    setTgMsg(null);
    try {
      const res = await fetch("/api/telegram/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "digest" }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        errors?: string[];
        quotes?: number;
      };
      setTgMsg(
        json.ok
          ? `Bilan 2h envoyé (${json.quotes ?? 0} cryptos) ✅`
          : json.errors?.join(" · ") || "Bilan non envoyé (chat non lié ?)",
      );
    } catch (err) {
      setTgMsg(err instanceof Error ? err.message : "Échec bilan");
    } finally {
      setTgBusy(false);
    }
  }

  if (loading && !data) {
    return (
      <p className="animate-pulse text-sm text-muted-foreground">
        Analyse multi-TF BTC / SOL + zones d’achat watchlist (règles locales)…
      </p>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-6">
        <p className="font-medium">Analyse marché indisponible</p>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        <Button className="mt-4" onClick={() => void load()}>
          Réessayer
        </Button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-4">
      <WatchlistSection data={data} />

      <section className="rounded-xl border border-border/80 bg-card/70 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">BTC · multi-timeframe</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Court (1h) · moyen (4h) · long (1d) · Hyperliquid
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <BiasBadge bias={data.bias} score={data.score} />
            <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCwIcon className={loading ? "animate-spin" : ""} />
              Tech
            </Button>
            <Button
              size="sm"
              onClick={() => void load({ ai: true })}
              disabled={aiLoading}
            >
              {aiLoading ? "IA…" : "Avis IA (cache 45 min)"}
            </Button>
          </div>
        </div>

        {(data.timeframes ?? [asLegacyFrame(data)]).map((frame) => (
          <TimeframeBlock key={frame.interval} frame={frame} />
        ))}
      </section>

      {data.sol ? (
        <section className="rounded-xl border border-border/80 bg-card/70 p-4">
          <h2 className="text-lg font-semibold">SOL · court & moyen terme</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            1h + 4h · zone d’achat calculée sans IA
          </p>
          {data.sol.buyZone ? <BuyZoneCard zone={data.sol.buyZone} /> : null}
          {data.sol.timeframes.map((frame) => (
            <TimeframeBlock key={`sol-${frame.interval}`} frame={frame} />
          ))}
        </section>
      ) : null}

      <section className="rounded-xl border border-border/80 bg-card/70 p-4">
        <h3 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          Zones d’achat idéales (watchlist)
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Règles locales (support / Bollinger / EMA / ATR) — 0 token IA
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {(data.watchBuyZones ?? []).map((zone) => (
            <BuyZoneCard key={zone.coin} zone={zone} compact />
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-border/80 bg-card/70 p-4">
        <h3 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          Telegram · @BoriazBot
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Bilan automatique toutes les 2h · notif immédiate si +1.5% en ~20 min
          sur RENDER, ONDO, UNI, BTC, SOL, ETH, HYPE, TAO.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          1) Envoie <code>/start</code> à{" "}
          <a
            className="text-primary underline"
            href="https://t.me/BoriazBot"
            target="_blank"
            rel="noreferrer"
          >
            @BoriazBot
          </a>
          . 2) Lier. 3) Tester / forcer un bilan.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void linkTelegram()} disabled={tgBusy}>
            Lier Telegram
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void testTelegram()}
            disabled={tgBusy}
          >
            Test
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void forceDigest()}
            disabled={tgBusy}
          >
            Forcer bilan 2h
          </Button>
          <Badge variant={data.telegram.linked ? "secondary" : "outline"}>
            {data.telegram.linked ? "Lié" : "Pas encore lié"}
          </Badge>
        </div>
        {data.priceWatch ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Prochain bilan auto ~ {formatExactTime(data.priceWatch.nextDigestAt)}
          </p>
        ) : null}
        {tgMsg ? <p className="mt-2 text-sm text-muted-foreground">{tgMsg}</p> : null}
      </section>

      <AiSection data={data} aiLoading={aiLoading} onAsk={() => void load({ ai: true })} />

      <section className="rounded-xl border border-border/80 bg-card/70 p-4">
        <h3 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          Contexte CoinGecko (BTC)
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
            CoinGecko indisponible pour le moment.
          </p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Maj {formatExactTime(data.fetchedAt)} · {data.disclaimer}
        </p>
      </section>
    </div>
  );
}

function WatchlistSection({ data }: { data: BtcAnalysisPayload }) {
  const quotes = data.watchQuotes ?? [];
  if (!quotes.length) {
    return (
      <section className="rounded-xl border border-dashed border-border/80 px-4 py-6 text-sm text-muted-foreground">
        Watchlist en initialisation (besoin de quelques minutes d’historique mids
        pour les %).
      </section>
    );
  }
  return (
    <section className="rounded-xl border border-border/80 bg-card/70 p-4">
      <h2 className="text-lg font-semibold">Watchlist live</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        RENDER · ONDO · UNI · BTC · SOL · ETH · HYPE · TAO — % depuis le poll
        dashboard
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-[11px] tracking-wide text-muted-foreground uppercase">
            <tr>
              <th className="pb-2 font-medium">Actif</th>
              <th className="pb-2 font-medium">Prix</th>
              <th className="pb-2 font-medium">15m</th>
              <th className="pb-2 font-medium">1h</th>
              <th className="pb-2 font-medium">2h</th>
            </tr>
          </thead>
          <tbody>
            {quotes.map((q) => (
              <tr key={q.coin} className="border-t border-border/50">
                <td className="py-2 font-medium">{q.label}</td>
                <td className="numeric py-2">{formatPx(q.price)}</td>
                <PctCell v={q.change15mPct} />
                <PctCell v={q.change1hPct} />
                <PctCell v={q.change2hPct} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PctCell({ v }: { v: number | null }) {
  return (
    <td
      className={`numeric py-2 ${v === null ? "text-muted-foreground" : signedClass(v)}`}
    >
      {v === null ? "n/d" : formatPct(v, 2)}
    </td>
  );
}

function TimeframeBlock({ frame }: { frame: TimeframeFrame }) {
  return (
    <div className="mt-4 rounded-lg border border-border/60 bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs tracking-wide text-muted-foreground uppercase">
            {frame.interval} · {frame.horizon}
          </p>
          <p className="mt-0.5 font-medium">{frame.summary}</p>
        </div>
        <BiasBadge bias={frame.bias} score={frame.score} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        <Metric label="Prix" value={formatPx(frame.indicators.price)} />
        <Metric
          label="24h"
          value={
            frame.indicators.change24hPct === null
              ? "n/d"
              : formatPct(frame.indicators.change24hPct, 2)
          }
          className={
            frame.indicators.change24hPct === null
              ? undefined
              : signedClass(frame.indicators.change24hPct)
          }
        />
        <Metric
          label="RSI14"
          value={
            frame.indicators.rsi14 === null
              ? "n/d"
              : frame.indicators.rsi14.toFixed(1)
          }
        />
        <Metric
          label="MACD hist"
          value={
            frame.indicators.macdHist === null
              ? "n/d"
              : frame.indicators.macdHist.toFixed(2)
          }
          className={
            frame.indicators.macdHist === null
              ? undefined
              : signedClass(frame.indicators.macdHist)
          }
        />
        <Metric
          label="EMA20"
          value={
            frame.indicators.ema20 === null
              ? "n/d"
              : formatPx(frame.indicators.ema20)
          }
        />
        <Metric
          label="EMA200"
          value={
            frame.indicators.ema200 === null
              ? "n/d"
              : formatPx(frame.indicators.ema200)
          }
        />
      </div>
      <Sparkline candles={frame.candles} label={frame.interval} />
      <BuyZoneCard zone={frame.buyZone} />
      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
        {frame.bullets.slice(0, 5).map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
    </div>
  );
}

function BuyZoneCard({
  zone,
  compact,
}: {
  zone: BuyZone;
  compact?: boolean;
}) {
  return (
    <div
      className={`mt-3 rounded-lg border border-primary/30 bg-primary/8 p-3 ${compact ? "mt-0" : ""}`}
    >
      <p className="text-xs tracking-wide text-primary uppercase">
        Zone achat {zone.coin}
      </p>
      <p className="mt-1 font-medium">
        {zone.label} · {zone.action.replaceAll("_", " ")} · {zone.quality}/100
      </p>
      {!compact ? (
        <>
          <p className="mt-1 text-sm text-muted-foreground">{zone.reason}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Distance mid {formatPct(zone.distancePct, 2)} · invalidation ~{" "}
            {formatPx(zone.invalidation)}
          </p>
        </>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
          {zone.summary}
        </p>
      )}
    </div>
  );
}

function AiSection({
  data,
  aiLoading,
  onAsk,
}: {
  data: BtcAnalysisPayload;
  aiLoading: boolean;
  onAsk: () => void;
}) {
  if (data.ai.skipped && !data.ai.enabled) {
    return (
      <section className="rounded-xl border border-border/80 bg-card/70 p-4">
        <h3 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          Avis IA (optionnel)
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Les analyses techniques et zones d’achat tournent sans IA. Clique
          « Avis IA » pour ChatGPT + Claude une fois (puis cache 45 min) — pour
          limiter la conso de tokens.
        </p>
        <Button className="mt-3" size="sm" onClick={onAsk} disabled={aiLoading}>
          Lancer l’avis IA
        </Button>
      </section>
    );
  }

  return (
    <>
      <section className="rounded-xl border border-border/80 bg-card/70 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
            ChatGPT
          </h3>
          {data.ai.cached ? (
            <Badge variant="outline">cache 45 min</Badge>
          ) : null}
        </div>
        {data.ai.openai.text ? (
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">
            {data.ai.openai.text}
          </p>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            {data.ai.openai.error || "Pas de réponse ChatGPT"}
          </p>
        )}
      </section>
      <section className="rounded-xl border border-border/80 bg-card/70 p-4">
        <h3 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          Claude
        </h3>
        {data.ai.anthropic.text ? (
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">
            {data.ai.anthropic.text}
          </p>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            {data.ai.anthropic.error || "Pas de réponse Claude"}
          </p>
        )}
      </section>
      {data.ai.consensus ? (
        <section className="rounded-xl border border-long/30 bg-long/8 p-4 text-sm">
          {data.ai.consensus}
        </section>
      ) : null}
    </>
  );
}

function BiasBadge({ bias, score }: { bias: string; score: number }) {
  const biasClass =
    bias === "haussier"
      ? "border-long/40 bg-long/10 text-long"
      : bias === "baissier"
        ? "border-short/40 bg-short/10 text-short"
        : "border-border text-muted-foreground";
  return (
    <Badge variant="outline" className={biasClass}>
      {bias} · {score}
    </Badge>
  );
}

function asLegacyFrame(data: BtcAnalysisPayload): TimeframeFrame {
  return {
    coin: data.symbol,
    interval: data.interval,
    horizon: data.horizon,
    candles: data.candles,
    indicators: data.indicators,
    bias: data.bias,
    score: data.score,
    summary: data.summary,
    bullets: data.bullets,
    buyTiming: data.buyTiming,
    buyZone: data.buyZone ?? {
      coin: data.symbol,
      low: data.indicators.support ?? data.indicators.price * 0.97,
      high: data.indicators.price,
      mid: data.indicators.price,
      distancePct: 0,
      quality: data.buyTiming.confidence,
      action: data.buyTiming.action,
      reason: data.buyTiming.reason,
      label: data.buyTiming.levels,
      invalidation: (data.indicators.support ?? data.indicators.price) * 0.98,
      summary: data.buyTiming.reason,
    },
  };
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
  label,
}: {
  candles: BtcAnalysisPayload["candles"];
  label: string;
}) {
  if (candles.length < 2) return null;
  const closes = candles.map((c) => c.c);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const w = 640;
  const h = 96;
  const points = closes
    .map((price, index) => {
      const x = (index / (closes.length - 1)) * w;
      const y = h - ((price - min) / (max - min || 1)) * (h - 8) - 4;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-border/60 bg-background/40 p-2">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-20 w-full">
        <polyline
          fill="none"
          stroke="oklch(0.8 0.11 195)"
          strokeWidth="2"
          points={points}
        />
      </svg>
      <p className="px-1 text-[11px] text-muted-foreground">
        {label} · {candles.length} bougies · {formatPx(min)} → {formatPx(max)}
      </p>
    </div>
  );
}
