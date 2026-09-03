"use client";

import { useEffect, useState } from "react";
import { CryptoLogo } from "@/components/crypto-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatPct, formatPx, signedClass } from "@/lib/format";
import type { HomePayload } from "@/lib/home";
import type { PaperAccount, PaperTrade } from "@/lib/user-types";
import { syncPaperFromBrowser, writeLocalPaper } from "@/lib/paper-local";

export function HomePanel({ onOpenTab }: { onOpenTab?: (tab: string) => void }) {
  const [data, setData] = useState<HomePayload | null>(null);
  const [account, setAccount] = useState<PaperAccount | null>(null);
  const [paperLive, setPaperLive] = useState<PaperTrade[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveAt, setLiveAt] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    async function loadFull() {
      try {
        const res = await fetch("/api/home", { cache: "no-store" });
        const json = (await res.json()) as HomePayload & { error?: string };
        if (!res.ok) throw new Error(json.error || "Accueil impossible");
        if (alive) {
          setData(json);
          setAccount(json.account);
          setPaperLive(json.paperOpen ?? []);
          if (json.paperOpen?.length) writeLocalPaper(json.paperOpen);
          setError(null);
          setLiveAt(json.fetchedAt);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Erreur");
      } finally {
        if (alive) setLoading(false);
      }
    }
    async function loadLive() {
      try {
        const res = await fetch("/api/live", { cache: "no-store" });
        const json = await res.json();
        if (!res.ok || !alive) return;
        setAccount(json.account);
        if (Array.isArray(json.paper)) {
          setPaperLive(json.paper);
          writeLocalPaper(json.paper);
        }
        setLiveAt(json.fetchedAt);
        setData((prev) => {
          if (!prev) return prev;
          const by = new Map(
            (
              json.quotes as {
                coin: string;
                price: number;
                change15mPct: number | null;
                change2hPct: number | null;
              }[]
            ).map((q) => [q.coin, q]),
          );
          return {
            ...prev,
            account: json.account,
            cards: prev.cards.map((c) => {
              const q = by.get(c.coin);
              return q
                ? {
                    ...c,
                    price: q.price,
                    change15mPct: q.change15mPct,
                    change2hPct: q.change2hPct,
                  }
                : c;
            }),
            fetchedAt: json.fetchedAt,
          };
        });
      } catch {
        // ignore
      }
    }
    void syncPaperFromBrowser().then((trades) => {
      if (trades && alive) setPaperLive(trades.filter((t) => t.status === "open" || t.status === "pending"));
    });
    void loadFull();
    const fullId = window.setInterval(() => void loadFull(), 60_000);
    const liveId = window.setInterval(() => void loadLive(), 4_000);
    return () => {
      alive = false;
      window.clearInterval(fullId);
      window.clearInterval(liveId);
    };
  }, []);

  if (loading && !data) {
    return (
      <p className="animate-pulse text-sm text-muted-foreground">
        Calcul Alignement BoriazBot…
      </p>
    );
  }
  if (error && !data) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4">
        <p className="font-medium">{error}</p>
        <Button className="mt-3" onClick={() => window.location.reload()}>
          Réessayer
        </Button>
      </div>
    );
  }
  if (!data) return null;

  const acc = account ?? data.account;
  const bestAlign = data.best?.alignment;

  return (
    <div className="space-y-6">
      <section className="bb-reveal relative overflow-hidden rounded-[1.75rem] border border-white/10 px-5 py-8 sm:px-8 sm:py-10">
        <div className="pointer-events-none absolute inset-0 bb-hero-glow" />
        <div className="relative">
          <p className="font-heading text-[0.7rem] tracking-[0.35em] text-primary uppercase">
            BoriazBot
          </p>
          <h1 className="font-heading mt-3 max-w-xl text-4xl leading-[0.95] tracking-tight text-foreground sm:text-5xl">
            Alignement
            <span className="block text-primary">avant le trade</span>
          </h1>
          <p className="mt-4 max-w-lg text-sm leading-relaxed text-muted-foreground sm:text-base">
            Score unique TF × crowd × Nansen × IA. Watchlist multi-TF. Sureté max
            Telegram. Paper {acc?.bankrollStartEur ?? 1000} €
            {liveAt
              ? ` · maj ${new Date(liveAt).toLocaleTimeString("fr-FR")}`
              : ""}
          </p>
          <div className="mt-5 flex flex-wrap gap-2 text-xs">
            <span className="rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 text-primary">
              Stockage {data.storage.backend === "upstash" ? "Upstash KV" : "/tmp"}
            </span>
            <span className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-muted-foreground">
              {data.maxSafetyMode ? "Sureté max ON" : "Sureté max OFF"}
            </span>
          </div>
        </div>
      </section>

      {acc ? (
        <section
          className="bb-reveal rounded-[1.5rem] border border-primary/25 bg-primary/5 px-4 py-5 sm:px-6"
          style={{ animationDelay: "80ms" }}
        >
          <p className="text-[0.65rem] tracking-[0.28em] text-primary uppercase">
            Simulation 1000 € · live ~4 s
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Chaque alerte ouvre un trade virtuel sur ce compte. La variation =
            ce que tu aurais gagné ou perdu. Pas d’argent réel.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <Stat label="Départ" value={`${acc.bankrollStartEur.toFixed(0)} €`} />
            <Stat
              label="Equity maintenant"
              value={`${acc.equityEur.toFixed(2)} €`}
              className={signedClass(acc.equityEur - acc.bankrollStartEur)}
            />
            <Stat
              label="Si tu avais suivi"
              value={`${acc.equityEur - acc.bankrollStartEur >= 0 ? "+" : ""}${(acc.equityEur - acc.bankrollStartEur).toFixed(2)} €`}
              className={signedClass(acc.equityEur - acc.bankrollStartEur)}
            />
            <Stat
              label="Latent / réalisé"
              value={`${acc.unrealizedPnlEur >= 0 ? "+" : ""}${acc.unrealizedPnlEur.toFixed(2)} / ${acc.realizedPnlEur >= 0 ? "+" : ""}${acc.realizedPnlEur.toFixed(2)} €`}
              className={signedClass(acc.unrealizedPnlEur + acc.realizedPnlEur)}
            />
          </div>
          {paperLive.length > 0 ? (
            <ul className="mt-4 space-y-2">
              {paperLive.map((t) => (
                <li
                  key={t.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/8 bg-background/35 px-3 py-2 text-sm"
                >
                  <span>
                    {t.status === "pending" ? "Limite" : "Open"} {t.side.toUpperCase()}{" "}
                    {t.coin} · entrée {formatPx(t.entry)}
                  </span>
                  <span className={`numeric font-semibold ${signedClass(t.pnlEur ?? 0)}`}>
                    {t.status === "pending"
                      ? "en attente"
                      : `${(t.pnlEur ?? 0) >= 0 ? "+" : ""}${(t.pnlEur ?? 0).toFixed(2)} €`}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              Aucune position simu ouverte — la prochaine alerte en créera une.
            </p>
          )}
          <p className="mt-3 text-[11px] text-muted-foreground">
            {data.storage.backend === "upstash"
              ? "Compte sauvé (Upstash) — survit aux redémarrages."
              : "Sans Upstash le serveur peut oublier le compte : on le recopie aussi dans ton navigateur."}
          </p>
        </section>
      ) : null}

      {data.divergences.length > 0 ? (
        <section className="bb-reveal space-y-2 rounded-2xl border border-amber-500/35 bg-amber-500/8 px-4 py-3">
          <p className="text-xs tracking-[0.2em] text-amber-200 uppercase">
            Alertes divergence
          </p>
          {data.divergences.map((d) => (
            <p key={d} className="text-sm text-amber-50/95">
              {d}
            </p>
          ))}
        </section>
      ) : null}

      {data.best && data.best.action !== "wait" && data.best.confidence >= 55 ? (
        <section
          className={`bb-reveal relative overflow-hidden rounded-[1.5rem] border px-4 py-5 sm:px-6 ${
            data.best.action === "short"
              ? "border-short/35 bg-short/8"
              : "border-long/35 bg-long/8"
          }`}
        >
          <p className="text-[0.65rem] tracking-[0.28em] text-muted-foreground uppercase">
            Setup prioritaire · Alignement d’abord
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <CryptoLogo symbol={data.best.coin} size={44} />
            <div>
              <p className="font-heading text-2xl font-semibold tracking-tight">
                {data.best.action.toUpperCase()} {data.best.coin}
              </p>
              <p className="text-sm text-muted-foreground">
                Conf. {data.best.confidence}/100 · {data.best.leverage} ·{" "}
                {data.best.sizePct}
              </p>
            </div>
            {bestAlign ? (
              <AlignBadge score={bestAlign.score} label={bestAlign.label} />
            ) : null}
            <Badge
              variant="outline"
              className={
                data.best.entryMode === "limit_wait"
                  ? "border-amber-500/40 text-amber-100"
                  : "border-long/40 text-long"
              }
            >
              {data.best.entryMode === "limit_wait"
                ? "Limite — attendre"
                : "Marché — maintenant"}
            </Badge>
          </div>

          {bestAlign ? (
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MiniBar label="TF" value={bestAlign.parts.tf} />
              <MiniBar label="Crowd" value={bestAlign.parts.crowd} />
              <MiniBar label="Nansen" value={bestAlign.parts.nansen} />
              <MiniBar label="IA" value={bestAlign.parts.ia} />
            </div>
          ) : null}

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Level label="Prix spot" value={formatPx(data.best.price)} />
            <Level
              label="Entrée"
              value={data.best.entry != null ? formatPx(data.best.entry) : "—"}
            />
            <Level
              label="Idéal limite"
              value={
                data.best.idealEntry != null
                  ? formatPx(data.best.idealEntry)
                  : "—"
              }
            />
            <Level
              label="TP"
              value={data.best.tp != null ? formatPx(data.best.tp) : "—"}
              className="text-long"
            />
            <Level
              label="SL"
              value={data.best.sl != null ? formatPx(data.best.sl) : "—"}
              className="text-short"
            />
          </div>

          {data.best.entryHint ? (
            <p className="mt-3 rounded-lg bg-background/35 px-3 py-2 text-sm">
              {data.best.entryHint}
            </p>
          ) : null}
          <p className="mt-2 text-sm">{data.best.aiText || data.best.reason}</p>
          {data.best.tfSummary ? (
            <p className="mt-1 text-xs text-muted-foreground">
              TF {data.best.tfSummary}
              {data.best.crowdWr != null
                ? ` · WR ${data.best.crowdWr.toFixed(0)}%`
                : ""}
            </p>
          ) : null}
        </section>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {data.cards.map((card, i) => (
          <article
            key={card.coin}
            className="bb-reveal group rounded-2xl border border-white/8 bg-card/50 p-4 backdrop-blur-sm transition-colors duration-300 hover:border-primary/25 hover:bg-card/80"
            style={{ animationDelay: `${120 + i * 40}ms` }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-3">
                <CryptoLogo symbol={card.coin} size={44} />
                <div>
                  <p className="font-heading text-lg font-semibold tracking-tight">
                    {card.label}
                  </p>
                  <p className="numeric text-xl font-medium">
                    {formatPx(card.price)}
                  </p>
                </div>
              </div>
              {card.alignment ? (
                <AlignBadge
                  score={card.alignment.score}
                  label={card.alignment.label}
                  compact
                />
              ) : null}
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge
                variant="outline"
                className={
                  card.direction === "long"
                    ? "border-long/40 bg-long/10 text-long"
                    : card.direction === "short"
                      ? "border-short/40 bg-short/10 text-short"
                      : ""
                }
              >
                {card.direction === "wait"
                  ? "Attendre"
                  : card.direction.toUpperCase()}
              </Badge>
              {card.entryMode ? (
                <Badge variant="outline" className="text-[10px]">
                  {card.entryMode === "limit_wait" ? "Limite" : "Marché"}
                </Badge>
              ) : null}
            </div>

            {card.alignment ? (
              <p className="mt-2 text-[10px] text-muted-foreground">
                {card.alignment.breakdown}
              </p>
            ) : null}

            {(card.direction === "long" || card.direction === "short") &&
            (card.entry || card.tp || card.sl) ? (
              <div className="mt-3 grid grid-cols-3 gap-1.5 text-[11px]">
                <div className="rounded-md bg-muted/25 px-1.5 py-1">
                  <p className="text-muted-foreground">Entrée</p>
                  <p className="numeric font-medium">
                    {card.entry != null ? formatPx(card.entry) : "—"}
                  </p>
                </div>
                <div className="rounded-md bg-muted/25 px-1.5 py-1">
                  <p className="text-muted-foreground">TP</p>
                  <p className="numeric font-medium text-long">
                    {card.tp != null ? formatPx(card.tp) : "—"}
                  </p>
                </div>
                <div className="rounded-md bg-muted/25 px-1.5 py-1">
                  <p className="text-muted-foreground">SL</p>
                  <p className="numeric font-medium text-short">
                    {card.sl != null ? formatPx(card.sl) : "—"}
                  </p>
                </div>
              </div>
            ) : null}

            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-muted/20 px-2 py-1.5">
                <p className="text-muted-foreground">15m</p>
                <p
                  className={`numeric font-medium ${
                    card.change15mPct === null
                      ? ""
                      : signedClass(card.change15mPct)
                  }`}
                >
                  {card.change15mPct === null
                    ? "n/d"
                    : formatPct(card.change15mPct, 2)}
                </p>
              </div>
              <div className="rounded-lg bg-muted/20 px-2 py-1.5">
                <p className="text-muted-foreground">2h</p>
                <p
                  className={`numeric font-medium ${
                    card.change2hPct === null ? "" : signedClass(card.change2hPct)
                  }`}
                >
                  {card.change2hPct === null
                    ? "n/d"
                    : formatPct(card.change2hPct, 2)}
                </p>
              </div>
            </div>

            {card.alignment?.divergence ? (
              <p className="mt-2 text-[11px] text-amber-200">
                {card.alignment.divergence}
              </p>
            ) : null}

            {card.tfSummary ? (
              <p className="mt-2 line-clamp-2 text-[10px] text-muted-foreground">
                TF {card.tfSummary}
              </p>
            ) : null}
            <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">
              {card.blurb}
            </p>
          </article>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => onOpenTab?.("lab")}>
          Lab · paper & backtest
        </Button>
        <Button variant="outline" size="sm" onClick={() => onOpenTab?.("macro")}>
          Macro
        </Button>
        <Button variant="outline" size="sm" onClick={() => onOpenTab?.("btc")}>
          Analyse
        </Button>
        <Button variant="outline" size="sm" onClick={() => onOpenTab?.("whales")}>
          Baleines
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">{data.storage.note}</p>
      <p className="text-xs text-muted-foreground">{data.disclaimer}</p>
    </div>
  );
}

function AlignBadge({
  score,
  label,
  compact,
}: {
  score: number;
  label: string;
  compact?: boolean;
}) {
  const tone =
    label === "fort"
      ? "border-long/40 bg-long/15 text-long"
      : label === "moyen"
        ? "border-primary/40 bg-primary/10 text-primary"
        : label === "bloqué"
          ? "border-short/40 bg-short/10 text-short"
          : "border-white/15 bg-white/5 text-muted-foreground";
  return (
    <div
      className={`rounded-xl border px-2.5 py-1.5 text-center ${tone} ${
        compact ? "" : "min-w-[4.5rem]"
      }`}
    >
      <p className="numeric text-lg font-semibold leading-none">{score}</p>
      <p className="mt-0.5 text-[9px] tracking-wide uppercase opacity-80">
        Align · {label}
      </p>
    </div>
  );
}

function MiniBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-background/30 px-2.5 py-2">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{label}</span>
        <span className="numeric">{value}</span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-primary/80 transition-all duration-700"
          style={{ width: `${Math.min(100, value)}%` }}
        />
      </div>
    </div>
  );
}

function Level({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="rounded-lg bg-background/35 px-2.5 py-2">
      <p className="text-[10px] tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p className={`numeric mt-0.5 text-sm font-semibold ${className ?? ""}`}>
        {value}
      </p>
    </div>
  );
}

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
    <div className="rounded-2xl border border-white/8 bg-card/40 px-3 py-3">
      <p className="text-[10px] tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p className={`numeric mt-0.5 text-lg font-semibold ${className ?? ""}`}>
        {value}
      </p>
    </div>
  );
}
