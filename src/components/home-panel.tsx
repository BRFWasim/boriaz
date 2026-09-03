"use client";

import { useEffect, useState } from "react";
import { CryptoLogo } from "@/components/crypto-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatPct, formatPx, signedClass } from "@/lib/format";
import type { HomePayload } from "@/lib/home";
import type { PaperAccount } from "@/lib/user-types";

export function HomePanel({ onOpenTab }: { onOpenTab?: (tab: string) => void }) {
  const [data, setData] = useState<HomePayload | null>(null);
  const [account, setAccount] = useState<PaperAccount | null>(null);
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
        setLiveAt(json.fetchedAt);
        setData((prev) => {
          if (!prev) return prev;
          const by = new Map(
            (json.quotes as { coin: string; price: number; change15mPct: number | null; change2hPct: number | null }[]).map(
              (q) => [q.coin, q],
            ),
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
        // ignore live hiccups
      }
    }
    void loadFull();
    const fullId = window.setInterval(() => void loadFull(), 45_000);
    const liveId = window.setInterval(() => void loadLive(), 8_000);
    return () => {
      alive = false;
      window.clearInterval(fullId);
      window.clearInterval(liveId);
    };
  }, []);

  if (loading && !data) {
    return (
      <p className="animate-pulse text-sm text-muted-foreground">
        Chargement des signaux BoriazBot…
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

  return (
    <div className="space-y-5">
      <section className="text-center sm:text-left">
        <p className="text-xs tracking-[0.22em] text-primary uppercase">
          BoriazBot
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
          Signaux live · watchlist
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Prix rafraîchis ~8 s · signaux ~45 s · paper 1000 €
          {liveAt ? ` · maj ${new Date(liveAt).toLocaleTimeString("fr-FR")}` : ""}
        </p>
      </section>

      {acc ? (
        <section className="grid gap-2 rounded-2xl border border-border/80 bg-card/70 p-4 sm:grid-cols-4">
          <Stat label="Solde départ" value={`${acc.bankrollStartEur.toFixed(0)} €`} />
          <Stat
            label="Equity paper"
            value={`${acc.equityEur.toFixed(2)} €`}
            className={signedClass(acc.equityEur - acc.bankrollStartEur)}
          />
          <Stat
            label="PnL réalisé"
            value={`${acc.realizedPnlEur >= 0 ? "+" : ""}${acc.realizedPnlEur.toFixed(2)} €`}
            className={signedClass(acc.realizedPnlEur)}
          />
          <Stat
            label="PnL latent"
            value={`${acc.unrealizedPnlEur >= 0 ? "+" : ""}${acc.unrealizedPnlEur.toFixed(2)} €`}
            className={signedClass(acc.unrealizedPnlEur)}
          />
        </section>
      ) : null}

      <section className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Comment lire une entrée ?</p>
        <p className="mt-1">{data.howto.entry}</p>
        <p className="mt-1">{data.howto.paper}</p>
      </section>

      {data.best && data.best.action !== "wait" && data.best.confidence >= 55 ? (
        <section
          className={`rounded-2xl border px-4 py-4 ${
            data.best.action === "short"
              ? "border-short/40 bg-short/10"
              : "border-long/40 bg-long/10"
          }`}
        >
          <p className="text-xs tracking-wide uppercase text-muted-foreground">
            Setup prioritaire · détail complet
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <CryptoLogo symbol={data.best.coin} size={40} />
            <div>
              <p className="text-xl font-semibold">
                {data.best.action.toUpperCase()} {data.best.coin}
              </p>
              <p className="text-sm text-muted-foreground">
                Confiance {data.best.confidence}/100 · levier {data.best.leverage} ·
                mise {data.best.sizePct}
              </p>
            </div>
            <Badge
              variant="outline"
              className={
                data.best.entryMode === "limit_wait"
                  ? "border-amber-500/40 text-amber-100"
                  : "border-long/40 text-long"
              }
            >
              {data.best.entryMode === "limit_wait"
                ? "Limite — attendre le prix"
                : "Marché — entrer maintenant"}
            </Badge>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
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
            <p className="mt-3 rounded-lg bg-background/40 px-3 py-2 text-sm">
              {data.best.entryHint}
            </p>
          ) : null}

          <p className="mt-2 text-sm">{data.best.aiText || data.best.reason}</p>
          {data.best.riskReward != null ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Risk/Reward ~ {data.best.riskReward.toFixed(2)}
            </p>
          ) : null}
          {data.best.closeSuggestion ? (
            <p className="mt-2 text-sm text-amber-200">
              Fermeture suggérée : {data.best.closeSuggestion}
            </p>
          ) : null}
          <p className="mt-2 text-xs text-muted-foreground">
            Invalidation : {data.best.invalidation}
          </p>
        </section>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {data.cards.map((card) => (
          <article
            key={card.coin}
            className="rounded-2xl border border-border/80 bg-card/80 p-4 shadow-none"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-3">
                <CryptoLogo symbol={card.coin} size={48} />
                <div>
                  <p className="text-lg font-semibold">{card.label}</p>
                  <p className="numeric text-xl font-medium">
                    {formatPx(card.price)}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <Badge
                variant="outline"
                className={
                  card.spotPhase === "achat"
                    ? "border-long/40 text-long"
                    : card.spotPhase === "vente"
                      ? "border-short/40 text-short"
                      : ""
                }
              >
                Spot · {card.spotPhase}
              </Badge>
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

            {(card.direction === "long" || card.direction === "short") &&
            (card.entry || card.tp || card.sl) ? (
              <div className="mt-3 space-y-2">
                <div className="grid grid-cols-3 gap-1.5 text-[11px]">
                  <div className="rounded-md bg-muted/30 px-1.5 py-1">
                    <p className="text-muted-foreground">Entrée</p>
                    <p className="numeric font-medium">
                      {card.entry != null ? formatPx(card.entry) : "—"}
                    </p>
                  </div>
                  <div className="rounded-md bg-muted/30 px-1.5 py-1">
                    <p className="text-muted-foreground">TP</p>
                    <p className="numeric font-medium text-long">
                      {card.tp != null ? formatPx(card.tp) : "—"}
                    </p>
                  </div>
                  <div className="rounded-md bg-muted/30 px-1.5 py-1">
                    <p className="text-muted-foreground">SL</p>
                    <p className="numeric font-medium text-short">
                      {card.sl != null ? formatPx(card.sl) : "—"}
                    </p>
                  </div>
                </div>
                {card.idealEntry != null ? (
                  <p className="text-[11px] text-muted-foreground">
                    Idéal limite {formatPx(card.idealEntry)}
                    {card.riskReward != null
                      ? ` · R:R ${card.riskReward.toFixed(1)}`
                      : ""}
                  </p>
                ) : null}
                {card.entryHint ? (
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    {card.entryHint}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-muted/30 px-2 py-1.5">
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
              <div className="rounded-lg bg-muted/30 px-2 py-1.5">
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

            {card.closeSuggestion ? (
              <p className="mt-2 text-[11px] text-amber-200">
                {card.closeSuggestion}
              </p>
            ) : null}

            <p className="mt-3 text-xs text-muted-foreground line-clamp-4">
              {card.blurb}
            </p>
            {card.invalidation ? (
              <p className="mt-1 text-[10px] text-muted-foreground line-clamp-2">
                Inv. {card.invalidation}
              </p>
            ) : null}
            <p className="mt-2 text-[11px] text-muted-foreground">
              Conf. {card.confidence} · {card.leverage} · {card.sizePct}
            </p>
          </article>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => onOpenTab?.("lab")}>
          Lab · paper 1000 €
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

      <p className="text-xs text-muted-foreground">{data.disclaimer}</p>
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
    <div className="rounded-lg bg-background/40 px-2.5 py-2">
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
    <div>
      <p className="text-[10px] tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p className={`numeric mt-0.5 text-lg font-semibold ${className ?? ""}`}>
        {value}
      </p>
    </div>
  );
}
