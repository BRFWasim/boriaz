"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangleIcon,
  FishIcon,
  RefreshCwIcon,
  SearchIcon,
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
import dynamic from "next/dynamic";
import { HomePanel } from "@/components/home-panel";
import { WhaleCard } from "@/components/whale-card";
import { formatAgo, formatExactTime } from "@/lib/format";
import type { AppTab, DashboardPayload, SortKey, UiMode } from "@/lib/types";

function PanelSkeleton({ label }: { label: string }) {
  return (
    <p className="animate-pulse text-sm text-muted-foreground">
      Chargement {label}…
    </p>
  );
}

const MarketOverviewPanel = dynamic(
  () =>
    import("@/components/market-overview").then((m) => m.MarketOverviewPanel),
  { ssr: false, loading: () => <PanelSkeleton label="Marché" /> },
);
const BtcAnalysisPanel = dynamic(
  () =>
    import("@/components/btc-analysis-panel").then((m) => m.BtcAnalysisPanel),
  { ssr: false, loading: () => <PanelSkeleton label="Analyse" /> },
);
const SpotAlertsPanel = dynamic(
  () =>
    import("@/components/spot-alerts-panel").then((m) => m.SpotAlertsPanel),
  { ssr: false, loading: () => <PanelSkeleton label="Spot" /> },
);
const MacroPanel = dynamic(
  () => import("@/components/macro-panel").then((m) => m.MacroPanel),
  { ssr: false, loading: () => <PanelSkeleton label="Macro" /> },
);
const LabPanel = dynamic(
  () => import("@/components/lab-panel").then((m) => m.LabPanel),
  { ssr: false, loading: () => <PanelSkeleton label="Lab" /> },
);

const BoriazPanel = dynamic(
  () => import("@/components/boriaz-panel").then((m) => m.BoriazPanel),
  { ssr: false, loading: () => <PanelSkeleton label="Boriaz" /> },
);


const POLL_MS = 10_000;

const PUBLIC_TAB_IDS: AppTab[] = ["home", "whales", "spot", "btc", "macro"];
const PRIVATE_TAB_IDS: AppTab[] = ["boriaz", "lab"];
const TAB_IDS: AppTab[] = [...PUBLIC_TAB_IDS, ...PRIVATE_TAB_IDS];

function parseTabHash(hash: string): AppTab | null {
  const raw = hash.replace(/^#/, "").trim().toLowerCase();
  if (!raw) return null;
  // Alias FR / anciens liens
  if (raw === "baleines" || raw === "baleines-perps" || raw === "perps") {
    return "whales";
  }
  if (raw === "accueil") return "home";
  if (raw === "analyse" || raw === "analyse-marche") return "btc";
  return TAB_IDS.includes(raw as AppTab) ? (raw as AppTab) : null;
}

export function WhalesDashboard() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("portfolio");
  const [coin, setCoin] = useState("all");
  const mode: UiMode = "advanced";
  const [tab, setTab] = useState<AppTab>("home");
  const [now, setNow] = useState(() => Date.now());
  const [followed, setFollowed] = useState<Set<string>>(new Set());
  const [cronStatus, setCronStatus] = useState<{
    at: number;
    ok: boolean;
    note?: string;
  } | null>(null);
  const [siteAuth, setSiteAuth] = useState<{
    enabled: boolean;
    authenticated: boolean;
  } | null>(null);
  const [theme, setTheme] = useThemeMode();

  const goTab = useCallback((next: AppTab) => {
    setTab(next);
    if (typeof window !== "undefined") {
      const want = `#${next}`;
      if (window.location.hash !== want) {
        window.history.replaceState(null, "", want);
      }
    }
  }, []);

  useEffect(() => {
    const sync = () => {
      const parsed = parseTabHash(window.location.hash);
      if (parsed) setTab(parsed);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

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
    fetch("/api/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((json: { lastCron?: { at: number; ok: boolean; note?: string } | null }) => {
        if (json.lastCron) setCronStatus(json.lastCron);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    fetch("/api/wallets", { cache: "no-store" })
      .then((r) => r.json())
      .then((json: { wallets?: { address: string }[] }) => {
        setFollowed(
          new Set((json.wallets ?? []).map((w) => w.address.toLowerCase())),
        );
      })
      .catch(() => undefined);
  }, []);


  useEffect(() => {
    let alive = true;
    fetch("/api/site-auth", { cache: "no-store" })
      .then((r) => r.json())
      .then((json: { enabled?: boolean; authenticated?: boolean }) => {
        if (!alive) return;
        setSiteAuth({
          enabled: Boolean(json.enabled),
          authenticated: Boolean(json.authenticated),
        });
      })
      .catch(() => {
        // En cas d’erreur réseau : rester verrouillé (pas d’accès Lab/Boriaz)
        if (alive) setSiteAuth({ enabled: true, authenticated: false });
      });
    return () => {
      alive = false;
    };
  }, []);

  // Boriaz + Lab UNIQUEMENT après login (cookie), jamais en public
  const unlocked = Boolean(siteAuth?.authenticated);

  useEffect(() => {
    if (siteAuth == null) return;
    if (!unlocked && (tab === "lab" || tab === "boriaz")) {
      goTab("home");
    }
  }, [siteAuth, unlocked, tab, goTab]);

  useEffect(() => {
    // Accueil / Analyse / Macro / Lab : pas d’appel baleines au mount
    if (tab !== "whales" && tab !== "spot") {
      setLoading(false);
    }
  }, [tab]);


  // Poll HL whales seulement sur les onglets qui en ont besoin
  useEffect(() => {
    if (tab !== "whales" && tab !== "spot") return;
    void load(true);
    const poll = window.setInterval(() => {
      void load(true);
    }, POLL_MS);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, [load, tab]);


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
    <div className="min-h-svh pb-[max(5.5rem,env(safe-area-inset-bottom))] sm:pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <header className="sticky top-0 z-30 border-b border-white/8 bg-background/85 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-1.5 px-3 py-2 sm:gap-3 sm:px-6 sm:py-3 lg:px-8">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <FishIcon className="size-4 shrink-0 text-primary" />
              <h1 className="font-heading truncate text-lg font-bold tracking-tight sm:text-2xl">BoriazBot</h1>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="bb-live-dot inline-flex items-center gap-1.5 rounded-md border border-long/30 bg-long/10 px-1.5 py-0.5 text-[10px] text-long sm:px-2 sm:text-xs">
                <span className="relative flex size-1.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-long opacity-70" />
                  <span className="relative inline-flex size-full rounded-full bg-long" />
                </span>
                {nextIn}s
              </span>
              {cronStatus ? (
                <span
                  className={`hidden rounded-md border px-1.5 py-0.5 text-[10px] sm:inline-flex ${
                    cronStatus.ok
                      ? "border-long/30 bg-long/10 text-long"
                      : "border-amber-400/30 bg-amber-400/10 text-amber-100"
                  }`}
                  title={cronStatus.note || "cron"}
                >
                  Cron {formatAgo(cronStatus.at)}
                </span>
              ) : null}
              <ThemeSwitch theme={theme} onChange={setTheme} />
              {siteAuth != null && !siteAuth.authenticated ? (
                <Button
                  type="button"
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  onClick={() => {
                    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.hash)}`;
                  }}
                >
                  Login
                </Button>
              ) : null}
              {siteAuth?.authenticated ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs text-muted-foreground"
                  onClick={() => {
                    void fetch("/api/site-auth", { method: "DELETE" }).then(() => {
                      setSiteAuth({ enabled: true, authenticated: false });
                      goTab("home");
                    });
                  }}
                >
                  Logout
                </Button>
              ) : null}
              <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => void load(true)} disabled={refreshing || loading}>
                <RefreshCwIcon className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>

          <div className="scrollbar-none -mx-1 hidden gap-1 overflow-x-auto px-1 sm:flex">
            <TabButton active={tab === "home"} onClick={() => goTab("home")}>Accueil</TabButton>
            <TabButton active={tab === "whales"} onClick={() => goTab("whales")}>Baleines</TabButton>
            <TabButton active={tab === "spot"} onClick={() => goTab("spot")}>Spot</TabButton>
            <TabButton active={tab === "btc"} onClick={() => goTab("btc")}>Analyse</TabButton>
            <TabButton active={tab === "macro"} onClick={() => goTab("macro")}>Macro</TabButton>
            {unlocked ? (
              <TabButton active={tab === "boriaz"} onClick={() => goTab("boriaz")}>Boriaz</TabButton>
            ) : null}
            {unlocked ? (
              <TabButton active={tab === "lab"} onClick={() => goTab("lab")}>Lab</TabButton>
            ) : null}
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
        {loading && !data && tab === "whales" ? <LoadingState /> : null}

        {error && !data && tab === "whales" ? (
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

        {tab === "home" ? (
          <HomePanel onOpenTab={(t) => goTab(t as AppTab)} />
        ) : null}

        {tab === "macro" ? <MacroPanel /> : null}

        {tab === "boriaz" && unlocked ? (
          <BoriazPanel onOpenLab={() => goTab("lab")} />
        ) : null}

        {tab === "lab" && unlocked ? <LabPanel /> : null}

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

        {followed.size > 0 ? (
          <p className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
            {followed.size} wallet{followed.size > 1 ? "s" : ""} suivi
            {followed.size > 1 ? "s" : ""} — alertes TG à chaque ouverture /
            fermeture (cron ~1 min + auto-follow wallets qualité).
          </p>
        ) : null}

        {whales.map((whale) => (
          <WhaleCard
            key={whale.address}
            whale={whale}
            coinFilter={coinFilter}
            mode={mode}
            followed={followed.has(whale.address.toLowerCase())}
            onFollowChange={(address, next) => {
              setFollowed((prev) => {
                const copy = new Set(prev);
                const key = address.toLowerCase();
                if (next) copy.add(key);
                else copy.delete(key);
                return copy;
              });
            }}
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

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl sm:hidden">
        <div className={`mx-auto grid max-w-7xl gap-0.5 px-1 py-1 ${unlocked ? "grid-cols-7" : "grid-cols-5"}`}>
          {(
            ([
              ["home", "Accueil"],
              ["whales", "Baleines"],
              ["spot", "Spot"],
              ["btc", "Analyse"],
              ["macro", "Macro"],
              ...(unlocked
                ? ([["boriaz", "Boriaz"], ["lab", "Lab"]] as const)
                : []),
            ] as const)
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => goTab(id)}
              className={`rounded-lg px-0.5 py-2 text-[10px] font-medium ${
                tab === id
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </nav>
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
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      aria-pressed={active}
      className={`relative z-30 inline-flex cursor-pointer items-center rounded-lg border px-3 py-1.5 text-sm transition ${
        active
          ? "border-primary/50 bg-primary/15 text-primary"
          : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50"
      }`}
    >
      {children}
    </button>
  );
}


const THEME_KEY = "boriazbot-theme";

function applyThemeClass(next: "dark" | "light") {
  const root = document.documentElement;
  root.classList.toggle("dark", next === "dark");
  root.classList.toggle("light", next === "light");
  root.style.colorScheme = next;
}

function useThemeMode(): ["dark" | "light", (t: "dark" | "light") => void] {
  const [theme, setThemeState] = useState<"dark" | "light">("dark");
  useEffect(() => {
    const saved = window.localStorage.getItem(THEME_KEY);
    const next = saved === "light" ? "light" : "dark";
    setThemeState(next);
    applyThemeClass(next);
  }, []);
  const setTheme = useCallback((next: "dark" | "light") => {
    setThemeState(next);
    window.localStorage.setItem(THEME_KEY, next);
    applyThemeClass(next);
  }, []);
  return [theme, setTheme];
}

function ThemeSwitch({
  theme,
  onChange,
}: {
  theme: "dark" | "light";
  onChange: (theme: "dark" | "light") => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
      <Button
        type="button"
        size="sm"
        variant={theme === "light" ? "default" : "ghost"}
        className="h-7 px-2 text-xs"
        onClick={() => onChange("light")}
      >
        Clair
      </Button>
      <Button
        type="button"
        size="sm"
        variant={theme === "dark" ? "default" : "ghost"}
        className="h-7 px-2 text-xs"
        onClick={() => onChange("dark")}
      >
        Sombre
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
