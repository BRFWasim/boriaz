"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangleIcon, FishIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WhaleCard } from "@/components/whale-card";
import { formatAgo, formatExactTime } from "@/lib/format";
import type { DashboardPayload, SortKey } from "@/lib/types";

const POLL_MS = 45_000;

export function WhalesDashboard() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("portfolio");
  const [coin, setCoin] = useState("all");
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    try {
      const res = await fetch("/api/whales", { cache: "no-store" });
      const json = (await res.json()) as DashboardPayload & { error?: string };
      if (!res.ok) {
        throw new Error(json.error || "Impossible de charger les baleines.");
      }
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur réseau");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/whales", { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        const json = (await res.json()) as DashboardPayload & { error?: string };
        if (!res.ok) {
          throw new Error(json.error || "Impossible de charger les baleines.");
        }
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
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const poll = window.setInterval(() => {
      void load(true);
    }, POLL_MS);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, [load]);

  const coinFilter =
    coin !== "all" && data && !data.coins.includes(coin) ? "all" : coin;

  const nextIn = data
    ? Math.max(0, Math.ceil((data.fetchedAt + POLL_MS - now) / 1000))
    : POLL_MS / 1000;

  const whales = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    let list = data.whales.filter((whale) => {
      if (coinFilter !== "all" && !whale.positions.some((p) => p.coin === coinFilter)) {
        return false;
      }
      if (!q) return true;
      return (
        whale.alias.toLowerCase().includes(q) ||
        whale.address.toLowerCase().includes(q) ||
        String(whale.rank) === q ||
        `#${whale.rank}` === q
      );
    });
    list = [...list].sort((a, b) => {
      if (sort === "pnl24h") return b.pnl24h - a.pnl24h;
      if (sort === "positions") return b.positions.length - a.positions.length;
      return b.portfolioUsd - a.portfolioUsd;
    });
    return list;
  }, [data, query, sort, coinFilter]);

  return (
    <div className="min-h-svh">
      <header className="border-b border-border/80 bg-[linear-gradient(180deg,oklch(0.18_0.03_250),transparent)]">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="flex items-center gap-2 text-xs tracking-[0.22em] text-primary uppercase">
                <FishIcon className="size-4" />
                Hyperliquid · Perpétuels
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                Les 10 plus grosses baleines
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                Positions ouvertes, levier, niveaux SL/TP lorsqu’ils existent, et
                clôtures récentes — à partir de l’API publique Hyperliquid, sans
                clé.
              </p>
            </div>
            <div className="flex flex-col items-start gap-2 sm:items-end">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="numeric">
                  Rafraîchissement {nextIn}s
                </Badge>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void load(true)}
                  disabled={refreshing || loading}
                >
                  <RefreshCwIcon className={refreshing ? "animate-spin" : ""} />
                  Actualiser
                </Button>
              </div>
              {data ? (
                <p className="text-xs text-muted-foreground">
                  Maj {formatExactTime(data.fetchedAt)} · {formatAgo(data.fetchedAt, now)}
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/8 px-4 py-3 text-sm text-amber-100/90">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-400" />
            <p>
              Ceci n’est pas un conseil financier. Les positions des baleines
              peuvent changer en quelques secondes ; les stops et take-profit ne
              sont affichés que s’ils sont réellement posés en carnet. Un compte
              peut clôturer, inverser ou retirer un SL/TP avant que cette page ne
              se mette à jour.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_12rem_12rem]">
            <div className="relative">
              <Label htmlFor="search" className="sr-only">
                Rechercher une baleine
              </Label>
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Rechercher par alias, rang ou adresse 0x…"
                className="h-9 pl-8"
              />
            </div>
            <div>
              <Label htmlFor="sort" className="sr-only">
                Trier
              </Label>
              <Select
                value={sort}
                onValueChange={(value) => {
                  if (value === "portfolio" || value === "pnl24h" || value === "positions") {
                    setSort(value);
                  }
                }}
              >
                <SelectTrigger className="h-9 w-full" id="sort">
                  <SelectValue placeholder="Trier" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="portfolio">Tri : portefeuille</SelectItem>
                  <SelectItem value="pnl24h">Tri : PnL 24h</SelectItem>
                  <SelectItem value="positions">Tri : nb de positions</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="coin" className="sr-only">
                Filtrer par crypto
              </Label>
              <Select value={coinFilter} onValueChange={(value) => value && setCoin(value)}>
                <SelectTrigger className="h-9 w-full" id="coin">
                  <SelectValue placeholder="Crypto" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Toutes les cryptos</SelectItem>
                  {(data?.coins ?? []).map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
        {loading && !data ? <LoadingState /> : null}

        {error && !data ? (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-6">
            <p className="font-medium">Chargement impossible</p>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
            <Button className="mt-4" onClick={() => void load(false)}>
              Réessayer
            </Button>
          </div>
        ) : null}

        {error && data ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">
            Rafraîchissement échoué : {error}. Les dernières données restent affichées.
          </p>
        ) : null}

        {data && whales.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
            Aucune baleine ne correspond à cette recherche ou à ce filtre.
          </p>
        ) : null}

        {whales.map((whale) => (
          <WhaleCard key={whale.address} whale={whale} coinFilter={coinFilter} />
        ))}

        {data ? (
          <footer className="space-y-2 pb-8 text-xs text-muted-foreground">
            <p>{data.scanNote}</p>
            <p>
              Sources : leaderboard public ({data.source.leaderboard}) et{" "}
              <code>POST {data.source.info}</code> (
              <code>clearinghouseState</code>, <code>frontendOpenOrders</code> /{" "}
              <code>openOrders</code>, <code>userFills</code>,{" "}
              <code>historicalOrders</code>, <code>metaAndAssetCtxs</code>).
              Cache serveur {data.nextRefreshSec}s pour respecter les limites de
              l’API.
            </p>
          </footer>
        ) : null}
      </main>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Lecture du leaderboard, puis des comptes perps, positions et ordres
        déclencheurs. Comptez une quinzaine de secondes au premier chargement.
      </p>
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className="h-48 animate-pulse rounded-xl border border-border bg-card/60"
        />
      ))}
    </div>
  );
}
