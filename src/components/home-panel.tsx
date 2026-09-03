"use client";

import { useEffect, useState } from "react";
import { CryptoLogo } from "@/components/crypto-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatPct, formatPx, signedClass } from "@/lib/format";
import type { HomePayload } from "@/lib/home";

export function HomePanel({ onOpenTab }: { onOpenTab?: (tab: string) => void }) {
  const [data, setData] = useState<HomePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch("/api/home", { cache: "no-store" });
        const json = (await res.json()) as HomePayload & { error?: string };
        if (!res.ok) throw new Error(json.error || "Accueil impossible");
        if (alive) {
          setData(json);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Erreur");
      } finally {
        if (alive) setLoading(false);
      }
    }
    void load();
    const id = window.setInterval(() => void load(), 60_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  if (loading && !data) {
    return (
      <p className="animate-pulse text-sm text-muted-foreground">
        Chargement des signaux live…
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

  return (
    <div className="space-y-5">
      <section className="text-center sm:text-left">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Vue rapide · watchlist
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Prix · phase spot · biais long/short · levier & mise suggérés (éducatif)
        </p>
      </section>

      {data.best && data.best.action !== "wait" && data.best.confidence >= 60 ? (
        <section
          className={`rounded-2xl border px-4 py-4 ${
            data.best.action === "short"
              ? "border-short/40 bg-short/10"
              : "border-long/40 bg-long/10"
          }`}
        >
          <p className="text-xs tracking-wide uppercase text-muted-foreground">
            Setup prioritaire
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
          </div>
          <p className="mt-2 text-sm">{data.best.aiText || data.best.reason}</p>
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
            </div>

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

            <p className="mt-3 text-xs text-muted-foreground line-clamp-3">
              {card.blurb}
            </p>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Conf. {card.confidence} · {card.leverage} · {card.sizePct}
            </p>
          </article>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onOpenTab?.("macro")}
        >
          Calendrier macro
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onOpenTab?.("btc")}
        >
          Analyse marché
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onOpenTab?.("whales")}
        >
          Baleines
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">{data.disclaimer}</p>
    </div>
  );
}
