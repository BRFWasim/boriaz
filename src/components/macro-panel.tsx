"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatExactTime } from "@/lib/format";
import type { MacroPayload } from "@/lib/macro";

export function MacroPanel() {
  const [data, setData] = useState<MacroPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch("/api/macro", { cache: "no-store" });
        const json = (await res.json()) as MacroPayload & { error?: string };
        if (!res.ok) throw new Error(json.error || "Macro impossible");
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
    const id = window.setInterval(() => void load(), 5 * 60_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  if (loading && !data) {
    return (
      <p className="animate-pulse text-sm text-muted-foreground">
        Chargement calendrier macro…
      </p>
    );
  }
  if (error && !data) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4">
        <p>{error}</p>
        <Button className="mt-3" onClick={() => window.location.reload()}>
          Réessayer
        </Button>
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border/80 bg-card/70 p-4">
        <h2 className="text-lg font-semibold">Macro · live & à venir</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {data.weekLabel} · source {data.source}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">{data.disclaimer}</p>
      </section>

      <section className="rounded-xl border border-short/30 bg-short/8 p-4">
        <h3 className="text-sm font-medium tracking-wide uppercase text-muted-foreground">
          Urgent / high impact (prochaines heures → jours)
        </h3>
        {data.urgent.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Pas d’événement High immédiat filtré USD/EUR.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {data.urgent.map((e) => (
              <EventCard key={e.id} e={e} accent />
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border/80 bg-card/70 p-4">
        <h3 className="text-sm font-medium tracking-wide uppercase text-muted-foreground">
          Semaine · Medium / High
        </h3>
        <div className="mt-3 space-y-2">
          {data.upcoming.map((e) => (
            <EventCard key={e.id} e={e} />
          ))}
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        Maj {formatExactTime(data.fetchedAt)}
      </p>
    </div>
  );
}

function EventCard({
  e,
  accent,
}: {
  e: MacroPayload["events"][number];
  accent?: boolean;
}) {
  return (
    <article
      className={`rounded-xl border px-3 py-3 ${
        accent ? "border-short/40 bg-background/40" : "border-border/60 bg-muted/20"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="outline"
          className={
            e.impact === "High"
              ? "border-short/40 text-short"
              : e.impact === "Medium"
                ? "border-amber-500/40 text-amber-600"
                : ""
          }
        >
          {e.impact}
        </Badge>
        <Badge variant="secondary">{e.country}</Badge>
        <Badge variant="outline">{e.status}</Badge>
        <span className="text-xs text-muted-foreground">
          {new Date(e.at).toLocaleString("fr-FR", {
            weekday: "short",
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
      <h4 className="mt-2 font-medium">{e.title}</h4>
      <p className="mt-1 text-xs text-muted-foreground">
        Forecast {e.forecast || "n/d"} · Prev {e.previous || "n/d"}
        {e.actual ? ` · Actual ${e.actual}` : ""}
      </p>
      <p className="mt-2 text-sm">{e.prediction}</p>
      <p className="mt-1 text-xs text-muted-foreground">{e.marketEffect}</p>
    </article>
  );
}
