"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import { CryptoLogo, CryptoName } from "@/components/crypto-logo";
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
    // Premier chargement avec IA batch (cache 45 min ensuite)
    void load({ ai: true });
    const id = window.setInterval(() => void load({ silent: true }), 90_000);
    return () => window.clearInterval(id);
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
      const json = (await res.json()) as { detail: string };
      setTgMsg(json.detail);
      await load({ silent: true });
    } catch (err) {
      setTgMsg(err instanceof Error ? err.message : "Échec liaison");
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
      setTgMsg(json.ok ? "Message test envoyé ✅" : json.error || "Échec");
    } catch (err) {
      setTgMsg(err instanceof Error ? err.message : "Échec");
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
          : json.errors?.join(" · ") || "Bilan non envoyé",
      );
    } catch (err) {
      setTgMsg(err instanceof Error ? err.message : "Échec");
    } finally {
      setTgBusy(false);
    }
  }

  if (loading && !data) {
    return (
      <p className="animate-pulse text-sm text-muted-foreground">
        Analyse multi-crypto + IA batch + Nansen…
      </p>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-6">
        <p className="font-medium">Analyse marché indisponible</p>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        <Button className="mt-4" onClick={() => void load({ ai: true })}>
          Réessayer
        </Button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-4">
      <WatchlistStrip data={data} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Analyses par crypto</h2>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCwIcon className={loading ? "animate-spin" : ""} />
            Tech
          </Button>
          <Button size="sm" onClick={() => void load({ ai: true })} disabled={aiLoading}>
            {aiLoading ? "IA…" : "Rafraîchir IA (cache 45 min)"}
          </Button>
          {data.watchAi?.cached ? <Badge variant="outline">IA en cache</Badge> : null}
          {data.integrations.nansen ? (
            <Badge variant="secondary">Nansen ON</Badge>
          ) : (
            <Badge variant="outline">Nansen off</Badge>
          )}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {(data.assetAnalyses ?? []).map((asset) => (
          <AssetCard key={asset.coin} asset={asset} highlight={asset.coin === "UNI"} />
        ))}
      </div>

      <TraderTrendsSection data={data} />

      <section className="rounded-xl border border-border/80 bg-card/70 p-4">
        <div className="flex items-center gap-2">
          <CryptoLogo symbol="BTC" size={28} />
          <h2 className="text-lg font-semibold">BTC · détail multi-TF</h2>
          <BiasBadge bias={data.bias} score={data.score} />
        </div>
        {(data.timeframes ?? []).map((frame) => (
          <TimeframeBlock key={frame.interval} frame={frame} />
        ))}
      </section>

      {data.sol ? (
        <section className="rounded-xl border border-border/80 bg-card/70 p-4">
          <div className="flex items-center gap-2">
            <CryptoLogo symbol="SOL" size={28} />
            <h2 className="text-lg font-semibold">SOL · court & moyen</h2>
          </div>
          {data.sol.buyZone ? <BuyZoneCard zone={data.sol.buyZone} /> : null}
          {data.sol.timeframes.map((frame) => (
            <TimeframeBlock key={`sol-${frame.interval}`} frame={frame} />
          ))}
        </section>
      ) : null}

      <section className="rounded-xl border border-border/80 bg-card/70 p-4">
        <h3 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          Telegram · @BoriazBot
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Bilan 2h + spikes +1.5 % + alertes prioritaires. Envoie /start puis lie.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void linkTelegram()} disabled={tgBusy}>
            Lier Telegram
          </Button>
          <Button size="sm" variant="outline" onClick={() => void testTelegram()} disabled={tgBusy}>
            Test
          </Button>
          <Button size="sm" variant="outline" onClick={() => void forceDigest()} disabled={tgBusy}>
            Forcer bilan 2h
          </Button>
          <Badge variant={data.telegram.linked ? "secondary" : "outline"}>
            {data.telegram.linked ? "Lié" : "Pas encore lié"}
          </Badge>
        </div>
        {tgMsg ? <p className="mt-2 text-sm text-muted-foreground">{tgMsg}</p> : null}
      </section>

      {(data.ai.openai.text || data.ai.anthropic.text) && (
        <>
          {data.ai.openai.text ? (
            <section className="rounded-xl border border-border/80 bg-card/70 p-4">
              <h3 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
                ChatGPT · BTC approfondi
              </h3>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">
                {data.ai.openai.text}
              </p>
            </section>
          ) : null}
          {data.ai.anthropic.text ? (
            <section className="rounded-xl border border-border/80 bg-card/70 p-4">
              <h3 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
                Claude · BTC approfondi
              </h3>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">
                {data.ai.anthropic.text}
              </p>
            </section>
          ) : null}
        </>
      )}

      <p className="text-xs text-muted-foreground">
        Maj {formatExactTime(data.fetchedAt)} · {data.disclaimer}
      </p>
    </div>
  );
}

function WatchlistStrip({ data }: { data: BtcAnalysisPayload }) {
  const quotes = data.watchQuotes ?? [];
  return (
    <section className="overflow-x-auto rounded-xl border border-border/80 bg-card/70 p-3">
      <p className="mb-2 text-[11px] tracking-wide text-muted-foreground uppercase">
        Prix live watchlist
      </p>
      <div className="flex min-w-max gap-2">
        {quotes.map((q) => (
          <div
            key={q.coin}
            className="min-w-[8.5rem] rounded-lg border border-border/50 bg-muted/30 px-3 py-2"
          >
            <div className="flex items-center gap-1.5">
              <CryptoLogo symbol={q.coin} size={18} />
              <span className="text-xs font-medium">{q.label}</span>
            </div>
            <p className="numeric mt-1 text-sm font-semibold">{formatPx(q.price)}</p>
            <p
              className={`numeric text-[11px] ${
                q.change15mPct === null ? "text-muted-foreground" : signedClass(q.change15mPct)
              }`}
            >
              15m {q.change15mPct === null ? "n/d" : formatPct(q.change15mPct, 2)}
            </p>
            <p
              className={`numeric text-[11px] ${
                q.change2hPct === null ? "text-muted-foreground" : signedClass(q.change2hPct)
              }`}
            >
              2h {q.change2hPct === null ? "n/d" : formatPct(q.change2hPct, 2)}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function AssetCard({
  asset,
  highlight,
}: {
  asset: NonNullable<BtcAnalysisPayload["assetAnalyses"]>[number];
  highlight?: boolean;
}) {
  const main =
    asset.timeframes.find((f) => f.interval === "4h") ?? asset.timeframes[0];
  if (!main) return null;
  return (
    <article
      className={`rounded-xl border bg-card/80 p-4 ${
        highlight ? "border-primary/50 ring-1 ring-primary/30" : "border-border/80"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <CryptoLogo symbol={asset.coin} size={32} />
          <div>
            <h3 className="font-semibold">
              {asset.label}
              {highlight ? (
                <span className="ml-2 text-xs font-normal text-primary">
                  analyse forcée multi-TF
                </span>
              ) : null}
            </h3>
            <p className="text-xs text-muted-foreground">
              {asset.timeframes.map((f) => f.interval).join(" · ")}
            </p>
          </div>
        </div>
        <BiasBadge bias={main.bias} score={main.score} />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
        <Metric label="Prix" value={formatPx(main.indicators.price)} />
        <Metric
          label="RSI"
          value={main.indicators.rsi14?.toFixed(1) ?? "n/d"}
        />
        <Metric
          label="Stoch"
          value={
            main.indicators.stochK === null
              ? "n/d"
              : main.indicators.stochK.toFixed(0)
          }
        />
        <Metric
          label="ADX"
          value={main.indicators.adx14?.toFixed(0) ?? "n/d"}
        />
        <Metric
          label="ROC12"
          value={
            main.indicators.roc12 === null
              ? "n/d"
              : formatPct(main.indicators.roc12, 2)
          }
          className={
            main.indicators.roc12 === null
              ? undefined
              : signedClass(main.indicators.roc12)
          }
        />
        <Metric
          label="Vol×"
          value={
            main.indicators.volumeRatio === null
              ? "n/d"
              : `×${main.indicators.volumeRatio.toFixed(2)}`
          }
        />
      </div>

      <Sparkline candles={main.candles} label={main.interval} />
      <BuyZoneCard zone={asset.buyZone} />

      {asset.aiText ? (
        <div className="mt-3 rounded-lg border border-long/25 bg-long/8 p-3">
          <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
            Avis IA
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
            {asset.aiText}
          </p>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          IA non chargée — clique « Rafraîchir IA ».
        </p>
      )}

      {asset.timeframes.length > 1 ? (
        <div className="mt-3 space-y-2">
          {asset.timeframes
            .filter((f) => f.interval !== main.interval)
            .map((f) => (
              <div
                key={f.interval}
                className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium uppercase">{f.interval}</span>
                  <BiasBadge bias={f.bias} score={f.score} />
                </div>
                <p className="mt-1 text-muted-foreground">{f.summary}</p>
              </div>
            ))}
        </div>
      ) : null}
    </article>
  );
}

function TraderTrendsSection({ data }: { data: BtcAnalysisPayload }) {
  const t = data.traderTrends;
  if (!t) return null;
  return (
    <section className="rounded-xl border border-border/80 bg-card/70 p-4">
      <h2 className="text-lg font-semibold">Tendances top traders</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Nansen smart money + leaderboard perps HL (7j) — ce qu’ils accumulent /
        shortent.
      </p>
      {!t.nansenEnabled ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Nansen off{t.nansenError ? ` · ${t.nansenError}` : ""}.
        </p>
      ) : null}
      {t.nansenError && t.nansenEnabled ? (
        <p className="mt-2 text-xs text-amber-600">{t.nansenError}</p>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div>
          <h3 className="text-xs tracking-wide text-muted-foreground uppercase">
            Leaderboard perps (Nansen)
          </h3>
          <ul className="mt-2 space-y-2 text-sm">
            {t.leaderboard.slice(0, 8).map((row) => (
              <li
                key={row.address}
                className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2"
              >
                <p className="font-medium">{row.label}</p>
                <p className={`numeric text-xs ${signedClass(row.totalPnl)}`}>
                  PnL {formatUsd(row.totalPnl)} · ROI{" "}
                  {formatPct(row.roi * 100, 1)}
                </p>
                {row.topCoin ? (
                  <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    Top <CryptoLogo symbol={row.topCoin} size={14} />{" "}
                    {row.topSide} {row.topCoin}
                    {row.topValueUsd
                      ? ` · ${formatUsd(row.topValueUsd)}`
                      : ""}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="text-xs tracking-wide text-muted-foreground uppercase">
            Trades perps récents
          </h3>
          <ul className="mt-2 max-h-80 space-y-1.5 overflow-y-auto text-xs">
            {t.recentPerpTrades.map((tr, i) => (
              <li
                key={`${tr.at}-${i}`}
                className="flex flex-wrap items-center gap-1.5 border-b border-border/40 py-1.5"
              >
                <CryptoLogo symbol={tr.symbol} size={14} />
                <span className="font-medium">{tr.symbol}</span>
                <span
                  className={
                    tr.side.toLowerCase().includes("short")
                      ? "text-short"
                      : "text-long"
                  }
                >
                  {tr.side} {tr.action}
                </span>
                <span className="numeric text-muted-foreground">
                  {formatUsd(tr.valueUsd)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="text-xs tracking-wide text-muted-foreground uppercase">
            Smart money netflows
          </h3>
          <ul className="mt-2 space-y-1.5 text-xs">
            {t.smartFlows.map((f) => (
              <li
                key={`${f.chain}-${f.symbol}`}
                className="flex items-center justify-between gap-2 rounded-lg bg-muted/20 px-2 py-1.5"
              >
                <span className="flex items-center gap-1.5">
                  <CryptoLogo symbol={f.symbol} size={14} />
                  {f.symbol}
                  <span className="text-muted-foreground">{f.chain}</span>
                </span>
                <span className={`numeric ${signedClass(f.netFlow24hUsd)}`}>
                  {formatUsd(f.netFlow24hUsd)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function TimeframeBlock({ frame }: { frame: TimeframeFrame }) {
  return (
    <div className="mt-4 rounded-lg border border-border/60 bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CryptoLogo symbol={frame.coin} size={18} />
          <div>
            <p className="text-xs tracking-wide text-muted-foreground uppercase">
              {frame.interval} · {frame.horizon}
            </p>
            <p className="mt-0.5 font-medium">{frame.summary}</p>
          </div>
        </div>
        <BiasBadge bias={frame.bias} score={frame.score} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        <Metric label="Prix" value={formatPx(frame.indicators.price)} />
        <Metric
          label="RSI"
          value={frame.indicators.rsi14?.toFixed(1) ?? "n/d"}
        />
        <Metric
          label="MACD h"
          value={frame.indicators.macdHist?.toFixed(2) ?? "n/d"}
        />
        <Metric
          label="Stoch"
          value={frame.indicators.stochK?.toFixed(0) ?? "n/d"}
        />
        <Metric
          label="ADX"
          value={frame.indicators.adx14?.toFixed(0) ?? "n/d"}
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
        <Metric
          label="ATR"
          value={
            frame.indicators.atr14 === null
              ? "n/d"
              : formatPx(frame.indicators.atr14)
          }
        />
      </div>
      <Sparkline candles={frame.candles} label={frame.interval} />
      <BuyZoneCard zone={frame.buyZone} />
    </div>
  );
}

function BuyZoneCard({ zone }: { zone: BuyZone }) {
  return (
    <div className="mt-3 rounded-lg border border-primary/30 bg-primary/8 p-3">
      <div className="flex items-center gap-2">
        <CryptoLogo symbol={zone.coin} size={16} />
        <p className="text-xs tracking-wide text-primary uppercase">
          Zone achat {zone.coin}
        </p>
      </div>
      <p className="mt-1 font-medium">
        {zone.label} · {zone.action.replaceAll("_", " ")} · {zone.quality}/100
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{zone.reason}</p>
    </div>
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
    <div className="rounded-lg bg-muted/30 px-2.5 py-2">
      <p className="text-[10px] tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p className={`numeric mt-0.5 text-sm font-medium ${className ?? ""}`}>
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
  const h = 72;
  const points = closes
    .map((price, index) => {
      const x = (index / (closes.length - 1)) * w;
      const y = h - ((price - min) / (max - min || 1)) * (h - 8) - 4;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-border/60 bg-background/40 p-2">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-16 w-full">
        <polyline
          fill="none"
          stroke="oklch(0.8 0.11 195)"
          strokeWidth="2"
          points={points}
        />
      </svg>
      <p className="px-1 text-[11px] text-muted-foreground">
        {label} · {formatPx(min)} → {formatPx(max)}
      </p>
    </div>
  );
}

// silence unused
void CryptoName;
