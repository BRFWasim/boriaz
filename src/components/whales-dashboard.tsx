"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  AlertTriangleIcon,
  FishIcon,
  LayoutListIcon,
  RefreshCwIcon,
  SearchIcon,
  SmartphoneIcon,
} from "lucide-react";
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
import { MarketOverviewPanel } from "@/components/market-overview";
import { BtcAnalysisPanel } from "@/components/btc-analysis-panel";
import { SpotAlertsPanel } from "@/components/spot-alerts-panel";
import { WhaleCard } from "@/components/whale-card";
import { formatAgo, formatExactTime } from "@/lib/format";
import type { AppTab, DashboardPayload, SortKey, UiMode } from "@/lib/types";

const POLL_MS = 20_000;
const MODE_KEY = "hl-whales-ui-mode";

export function WhalesDashboard() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("portfolio");
  const [coin, setCoin] = useState("all");
  const [mode, setModeState] = useUiMode();
  const [tab, setTab] = useState<AppTab>("whales");
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

  function chooseMode(next: UiMode) {
    setModeState(next);
  }

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
      if (sort === "pnl24h") return b.day.pnl - a.day.pnl;
      if (sort === "positions") return b.positions.length - a.positions.length;
      if (sort === "unrealized") {
        return b.exposure.unrealizedTotal - a.exposure.unrealizedTotal;
      }
      if (sort === "risk") return b.riskScore - a.riskScore;
      if (sort === "winrate") {
        return (b.tradeStats.winRate ?? -1) - (a.tradeStats.winRate ?? -1);
      }
      return b.portfolioUsd - a.portfolioUsd;
    });
    return list;
  }, [data, query, sort, coinFilter]);

  return (
    <div className="min-h-svh pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <header className="sticky top-0 z-20 border-b border-border/80 bg-background/90 pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-xs tracking-[0.22em] text-primary uppercase">
                <FishIcon className="size-4" />
                Hyperliquid · Perpétuels
              </p>
              <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-3xl">
                Les 10 plus grosses baleines
              </h1>
            </div>
            <div className="flex flex-col items-stretch gap-2 sm:items-end">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-full border border-long/30 bg-long/10 px-2.5 py-1 text-xs text-long">
                  <span className="relative flex size-2">
                    <span className="absolute inline-flex size-2 animate-ping rounded-full bg-long opacity-70" />
                    <span className="relative inline-flex size-2 rounded-full bg-long" />
                  </span>
                  Quasi en direct · {nextIn}s
                </span>
                <ModeSwitch mode={mode} onChange={chooseMode} />
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

          <p className="text-sm text-muted-foreground">
            Si une baleine clôture une position pour en ouvrir une autre, la
            nouvelle apparaît ici au cycle suivant (environ 20 secondes). Ce
            n’est pas du tick-par-tick comme le carnet Hyperliquid.
          </p>

          <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/8 px-3 py-2.5 text-sm text-amber-100/90">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-400" />
            <p>
              Pas un conseil financier. Les baleines peuvent changer de position
              en quelques secondes. Un SL/TP n’est affiché que s’il est vraiment
              posé.
            </p>
          </div>

          <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-sm">
            <SmartphoneIcon className="mt-0.5 size-4 shrink-0 text-primary" />
            <p>
              <span className="font-medium">Sur téléphone et bureau :</span>{" "}
              ouvrez cette page, puis installez-la pour l’utiliser comme une
              app. iPhone : Partager → Sur l’écran d’accueil. Chrome / Android /
              ordinateur : Installer dans la barre d’adresse.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <TabButton active={tab === "whales"} onClick={() => setTab("whales")}>
              Baleines perps
            </TabButton>
            <TabButton active={tab === "spot"} onClick={() => setTab("spot")}>
              Spot & alertes
              {data?.overview.shortWithSpotCount ? (
                <span className="ml-1 rounded-full bg-short/20 px-1.5 text-[10px] text-short">
                  {data.overview.shortWithSpotCount}
                </span>
              ) : null}
            </TabButton>
            <TabButton active={tab === "btc"} onClick={() => setTab("btc")}>
              Analyse BTC
            </TabButton>
          </div>

          {tab === "whales" ? (
          <div className="grid gap-2 sm:grid-cols-[1fr_11rem_11rem]">
            <div className="relative">
              <Label htmlFor="search" className="sr-only">
                Rechercher une baleine
              </Label>
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Alias, rang ou adresse 0x…"
                className="h-10 pl-8 sm:h-9"
              />
            </div>
            <div>
              <Label htmlFor="sort" className="sr-only">
                Trier
              </Label>
              <Select
                value={sort}
                onValueChange={(value) => {
                  if (
                    value === "portfolio" ||
                    value === "pnl24h" ||
                    value === "positions" ||
                    value === "unrealized" ||
                    value === "risk" ||
                    value === "winrate"
                  ) {
                    setSort(value);
                  }
                }}
              >
                <SelectTrigger className="h-10 w-full sm:h-9" id="sort">
                  <SelectValue placeholder="Trier" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="portfolio">Tri : portefeuille</SelectItem>
                  <SelectItem value="pnl24h">Tri : PnL 24h</SelectItem>
                  <SelectItem value="unrealized">Tri : PnL latent</SelectItem>
                  <SelectItem value="positions">Tri : nb de positions</SelectItem>
                  <SelectItem value="risk">Tri : risque</SelectItem>
                  <SelectItem value="winrate">Tri : win rate</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="coin" className="sr-only">
                Filtrer par crypto
              </Label>
              <Select value={coinFilter} onValueChange={(value) => value && setCoin(value)}>
                <SelectTrigger className="h-10 w-full sm:h-9" id="coin">
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
          ) : null}
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl space-y-4 px-4 py-5 sm:px-6 lg:px-8">
        {loading && !data && tab !== "btc" ? <LoadingState /> : null}

        {error && !data && tab !== "btc" ? (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-6">
            <p className="font-medium">Chargement impossible</p>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
            <Button className="mt-4" onClick={() => void load(false)}>
              Réessayer
            </Button>
          </div>
        ) : null}

        {error && data && tab === "whales" ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm">
            Rafraîchissement échoué : {error}. Les dernières données restent affichées.
          </p>
        ) : null}

        {tab === "btc" ? <BtcAnalysisPanel /> : null}

        {tab === "spot" && data ? <SpotAlertsPanel data={data} /> : null}

        {tab === "whales" ? (
          <>
        {data?.overview ? <MarketOverviewPanel overview={data.overview} /> : null}

        {data && whales.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
            Aucune baleine ne correspond à cette recherche ou à ce filtre.
          </p>
        ) : null}

        {whales.map((whale) => (
          <WhaleCard
            key={whale.address}
            whale={whale}
            coinFilter={coinFilter}
            mode={mode}
          />
        ))}

        {data ? (
          <footer className="space-y-2 pb-8 text-xs text-muted-foreground">
            <p>{data.scanNote}</p>
            <p>
              Sources publiques Hyperliquid + CoinGecko (BTC). Clés manquantes :{" "}
              {data.integrations.missingKeys.join(", ") || "aucune critique"}.
              Positions relues toutes les {data.nextRefreshSec}s.
            </p>
          </footer>
        ) : null}
          </>
        ) : null}
      </main>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center rounded-lg border px-3 py-1.5 text-sm transition ${
        active
          ? "border-primary/50 bg-primary/15 text-primary"
          : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50"
      }`}
    >
      {children}
    </button>
  );
}

function useUiMode(): [UiMode, (mode: UiMode) => void] {
  const mode = useSyncExternalStore(subscribeMode, getMode, () => "simple" as const);
  const setMode = (next: UiMode) => {
    window.localStorage.setItem(MODE_KEY, next);
    window.dispatchEvent(new Event("hl-ui-mode"));
  };
  return [mode, setMode];
}

function subscribeMode(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener("hl-ui-mode", onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener("hl-ui-mode", onStoreChange);
  };
}

function getMode(): UiMode {
  const saved = window.localStorage.getItem(MODE_KEY);
  return saved === "advanced" ? "advanced" : "simple";
}

function ModeSwitch({
  mode,
  onChange,
}: {
  mode: UiMode;
  onChange: (mode: UiMode) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
      <Button
        type="button"
        size="sm"
        variant={mode === "simple" ? "default" : "ghost"}
        className="h-7 px-2.5"
        onClick={() => onChange("simple")}
      >
        <SmartphoneIcon />
        Simple
      </Button>
      <Button
        type="button"
        size="sm"
        variant={mode === "advanced" ? "default" : "ghost"}
        className="h-7 px-2.5"
        onClick={() => onChange("advanced")}
      >
        <LayoutListIcon />
        Avancé
      </Button>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Lecture du leaderboard et des comptes perps. Une quinzaine de secondes
        au premier chargement, puis mise à jour automatique.
      </p>
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className="h-40 animate-pulse rounded-xl border border-border bg-card/60"
        />
      ))}
    </div>
  );
}
