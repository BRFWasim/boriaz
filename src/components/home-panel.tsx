"use client";

import { useEffect, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { CryptoLogo } from "@/components/crypto-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatPct, formatPx, formatParisDateTime, signedClass } from "@/lib/format";
import type { HomePayload, PortfolioHomeView } from "@/lib/home";
import type {
  PaperAccount,
  PaperTrade,
  PortfolioProfile,
  UserPrefs,
} from "@/lib/user-types";
import {
  aggregatePaperAccount,
  computePaperAccount,
  ensurePortfolios,
} from "@/lib/user-types";
import { syncPaperFromBrowser, writeLocalPaper } from "@/lib/paper-local";
import { readResponseJson } from "@/lib/safe-json";
import { PriceChart } from "@/components/price-chart";
import { TradeLiveReview } from "@/components/trade-live-review";

const PREFS_LS_KEY = "boriazbot-prefs-v1";

type SessionUser = {
  id: string;
  name: string;
  guest: boolean;
  bankrollEur: number;
};

export function HomePanel({ onOpenTab }: { onOpenTab?: (tab: string) => void }) {
  const [data, setData] = useState<HomePayload | null>(null);
  const [account, setAccount] = useState<PaperAccount | null>(null);
  const [paperLive, setPaperLive] = useState<PaperTrade[]>([]);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveAt, setLiveAt] = useState<number | null>(null);
  const [lsPortfolios, setLsPortfolios] = useState<PortfolioProfile[]>([]);
  const [openPf, setOpenPf] = useState<Record<string, boolean>>({
    default: true,
  });
  const [selectedCoin, setSelectedCoin] = useState<string | null>(null);
  const [cryptoFilter, setCryptoFilter] = useState<"all" | "long" | "short" | "wait">("all");
  function mergePaper(next: PaperTrade[] | undefined) {
    if (!next?.length) return;
    setPaperLive((prev) => {
      const byId = new Map(prev.map((t) => [t.id, t]));
      for (const t of next) byId.set(t.id, t);
      const merged = [...byId.values()].sort((a, b) => b.openedAt - a.openedAt);
      writeLocalPaper(merged);
      return merged;
    });
  }

  async function closeTrade(id: string) {
    try {
      const res = await fetch("/api/paper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close", id }),
      });
      const json = await readResponseJson<{
        trades?: PaperTrade[];
        account?: PaperAccount;
      }>(res);
      if (res.ok) {
        if (Array.isArray(json.trades)) mergePaper(json.trades);
        if (json.account) setAccount(json.account);
      }
    } catch {
      /* ignore */
    }
  }

  async function mirrorTradeToLive(id: string) {
    setActionMsg("Copie paper → LIVE au marché…");
    try {
      const res = await fetch("/api/live-mirror", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paperId: id }),
      });
      const json = await readResponseJson<{
        error?: string;
        ok?: boolean;
        mid?: number;
        live?: { size?: string; entryOid?: number | null; botLabel?: string };
        trade?: PaperTrade;
      }>(res);
      if (res.ok && json.ok && json.trade) {
        mergePaper([json.trade]);
        setActionMsg(
          `LIVE HL ✓ @ mid ${json.mid} · size ${json.live?.size ?? "?"} · oid ${json.live?.entryOid ?? "—"}`,
        );
      } else {
        const err = json.error || "Copie LIVE échouée";
        setActionMsg(err);
      }
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : "Copie LIVE impossible");
    }
  }

  useEffect(() => {
    let alive = true;
    async function loadFull() {
      // Portefeuilles enregistrés côté navigateur (Lab) : garantit que scalp /
      // risqué restent visibles même si une réponse serveur ne les renvoie pas
      // (ex. scope utilisateur transitoire).
      try {
        const raw = localStorage.getItem(PREFS_LS_KEY);
        if (raw && alive) {
          const parsed = JSON.parse(raw) as UserPrefs;
          setLsPortfolios(ensurePortfolios(parsed.portfolios));
        }
      } catch {
        /* ignore */
      }
      try {
        const res = await fetch("/api/home", { cache: "no-store" });
        const json = await readResponseJson<HomePayload & { error?: string }>(res);
        if (!res.ok) throw new Error(json.error || "Accueil impossible");
        if (alive) {
          setData(json);
          setAccount(json.account);
          mergePaper(json.paperAll ?? json.paperOpen);
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
        const json = await readResponseJson<{
          account?: PaperAccount;
          paper?: PaperTrade[];
          fetchedAt?: number;
          quotes?: {
            coin: string;
            price: number;
            change15mPct: number | null;
            change2hPct: number | null;
          }[];
        }>(res);
        if (!res.ok || !alive) return;
        if (json.account) setAccount(json.account);
        if (Array.isArray(json.paper)) mergePaper(json.paper);
        if (json.fetchedAt != null) setLiveAt(json.fetchedAt);
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
            account: json.account ?? prev.account,
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
            fetchedAt: json.fetchedAt ?? prev.fetchedAt,
          };
        });
      } catch {
        // ignore
      }
    }
    void fetch("/api/account", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (alive && j.user) setUser(j.user);
      })
      .catch(() => undefined);
    void syncPaperFromBrowser().then((trades) => {
      if (trades && alive) mergePaper(trades);
    });
    void loadFull();
    const fullId = window.setInterval(() => void loadFull(), 60_000);
    const liveId = window.setInterval(() => void loadLive(), 4_000);

    // Relecture rapide des trades ouverts (PnL + structure, sans IA lourde)
    async function reviewOpenFast() {
      try {
        const res = await fetch("/api/manage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fast: true }),
        });
        if (!res.ok) return;
        const json = await readResponseJson<{
          trades?: PaperTrade[];
          account?: PaperAccount;
        }>(res);
        if (Array.isArray(json.trades) && json.trades.length) {
          mergePaper(json.trades);
        }
        if (json.account) setAccount(json.account);
      } catch {
        /* ignore — login / rate */
      }
    }
    const reviewSoon = window.setTimeout(() => void reviewOpenFast(), 8_000);
    const reviewId = window.setInterval(() => void reviewOpenFast(), 45_000);

    return () => {
      alive = false;
      window.clearInterval(fullId);
      window.clearInterval(liveId);
      window.clearTimeout(reviewSoon);
      window.clearInterval(reviewId);
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

  const openTrades = paperLive.filter(
    (t) => t.status === "open" || t.status === "pending",
  );
  const heroTrade = openTrades[0] ?? null;
  const bestAlign = data.best?.alignment;

  // Union des profils serveur + navigateur → scalp/risqué toujours affichés,
  // même si une réponse serveur transitoire ne renvoie que le défaut.
  const profileMap = new Map<string, PortfolioProfile>();
  for (const p of lsPortfolios) profileMap.set(p.id, p);
  for (const pv of data.portfolios ?? [])
    profileMap.set(pv.profile.id, pv.profile);
  const mergedProfiles = ensurePortfolios([...profileMap.values()]).filter(
    (p) => p.enabled,
  );

  // Chaque section ET le total sont calculés à partir des MÊMES trades live →
  // plus de désync entre l'entête d'une section et ses lignes, ni de PnL total
  // incohérent avec le détail.
  const portfolioViews: PortfolioHomeView[] = mergedProfiles.map((profile) => {
    const open = paperLive.filter(
      (t) =>
        (t.portfolioId || "default") === profile.id &&
        (t.status === "open" || t.status === "pending"),
    );
    return {
      profile,
      openTrades: open,
      account: {
        ...computePaperAccount(paperLive, profile.bankrollEur, profile.id),
        portfolioId: profile.id,
        portfolioName: profile.name,
      },
    };
  });

  // Total = somme EXACTE des sections affichées (mêmes trades live).
  const acc: PaperAccount = paperLive.length
    ? aggregatePaperAccount(paperLive, mergedProfiles)
    : (account ?? data.account);

  function togglePf(id: string) {
    setOpenPf((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  const filteredCards =
    cryptoFilter === "all"
      ? data.cards
      : cryptoFilter === "wait"
        ? data.cards.filter((c) => c.direction === "wait")
        : data.cards.filter((c) => c.direction === cryptoFilter);
  const activeCoin = (() => {
    const cards = filteredCards.length ? filteredCards : data.cards;
    if (!cards.length) return null;
    if (selectedCoin && cards.some((c) => c.coin === selectedCoin)) {
      return selectedCoin;
    }
    return cards[0]?.coin ?? null;
  })();
  const selectedCard =
    data.cards.find((c) => c.coin === activeCoin) ?? null;

  return (
    <div className="space-y-6">
      {actionMsg ? (
        <div
          className={`rounded-xl border px-3 py-2 text-sm ${
            /LIVE HL ✓/i.test(actionMsg)
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
              : /Copie paper/i.test(actionMsg)
                ? "border-amber-400/30 bg-amber-400/10 text-amber-100"
                : "border-destructive/40 bg-destructive/10 text-destructive"
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs sm:text-sm">{actionMsg}</p>
            <button
              type="button"
              className="shrink-0 text-[11px] opacity-70 hover:opacity-100"
              onClick={() => setActionMsg(null)}
            >
              Fermer
            </button>
          </div>
        </div>
      ) : null}

      {data.warning || data.degraded || data.signalsPending ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
          <div>
            <p className="font-medium">
              {data.signalsPending
                ? "Analyse en cours — prix / paper affichés"
                : data.degraded
                  ? "Mode dégradé"
                  : "Alerte"}
            </p>
            <p className="text-xs text-amber-100/80">
              {data.warning ||
                "Les signaux complets arrivent dès que Hyperliquid / IA répondent."}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 border-amber-400/40 text-amber-50"
            onClick={() => window.location.reload()}
          >
            Relancer
          </Button>
        </div>
      ) : null}

      {acc ? (
        <section
          className="bb-reveal rounded-[1.5rem] border border-primary/25 bg-primary/5 px-4 py-5 sm:px-6"
          style={{ animationDelay: "80ms" }}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[0.65rem] tracking-[0.28em] text-primary uppercase">
                Catégorie fictive · paper {acc.bankrollStartEur.toFixed(0)} € ·{" "}
                {user?.guest === false ? user.name : user?.name ?? "invité"}
              </p>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                Simulation seulement — n’envoie aucun ordre sur HL. Le capital
                paper (1000 €) ne size pas le live. Trades figés jusqu’au TP/SL.
              </p>
            </div>
            <AccountBox user={user} onUser={setUser} />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-5">
            <Stat label="Départ" value={`${acc.bankrollStartEur.toFixed(0)} €`} />
            <Stat
              label="Cash libre"
              value={`${acc.cashEur.toFixed(2)} €`}
            />
            <Stat
              label="Marge sortie"
              value={`${acc.marginUsedEur.toFixed(2)} €`}
            />
            <Stat
              label="Equity"
              value={`${acc.equityEur.toFixed(2)} €`}
              className={signedClass(acc.equityEur - acc.bankrollStartEur)}
            />
            <Stat
              label="Total si suivi"
              value={`${acc.equityEur - acc.bankrollStartEur >= 0 ? "+" : ""}${(acc.equityEur - acc.bankrollStartEur).toFixed(2)} €`}
              className={signedClass(acc.equityEur - acc.bankrollStartEur)}
            />
          </div>
        </section>
      ) : null}

      <section className="bb-reveal space-y-3">
        <div>
          <h2 className="font-heading text-lg font-semibold">
            Portefeuilles fictifs (paper)
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Books de simulation. Le wallet réel est dans la carte verte
            ci-dessus. Défaut / Boriaz / Scalp : réglages dans le Lab.
          </p>
        </div>
        {portfolioViews.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucun portefeuille — ouvre le Lab pour en créer.
          </p>
        ) : (
          portfolioViews.map((pf) => {
            const expanded = openPf[pf.profile.id] ?? false;
            const delta = pf.account.equityEur - pf.account.bankrollStartEur;
            const trades = paperLive.filter(
              (t) => (t.portfolioId || "default") === pf.profile.id,
            );
            const launched = trades.length;
            const closed = trades.filter(
              (t) =>
                t.status === "tp" ||
                t.status === "sl" ||
                t.status === "closed_manual" ||
                t.status === "expired" ||
                t.status === "invalidated",
            );
            const wins = closed.filter(
              (t) => t.status === "tp" || (t.pnlEur ?? 0) > 0,
            );
            const winRatePct =
              closed.length > 0 ? (wins.length / closed.length) * 100 : null;
            const pending = trades.filter((t) => t.status === "pending");
            const running = trades.filter((t) => t.status === "open");
            const tps = trades.filter((t) => t.status === "tp");
            const sls = trades.filter((t) => t.status === "sl");
            const otherClosed = trades.filter(
              (t) =>
                t.status === "closed_manual" ||
                t.status === "expired" ||
                t.status === "invalidated",
            );
            return (
              <div
                key={pf.profile.id}
                className="rounded-2xl border border-white/10 bg-card/40"
              >
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                  onClick={() => togglePf(pf.profile.id)}
                  aria-expanded={expanded}
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      {pf.profile.name}
                      {pf.profile.isDefault ? (
                        <span className="ml-2 text-[10px] tracking-wide text-primary uppercase">
                          défaut
                        </span>
                      ) : null}
                      {pf.profile.strategy === "smc" ||
                      pf.profile.id === "boriaz" ? (
                        <span className="ml-2 text-[10px] tracking-wide text-amber-400 uppercase">
                          SMC 2%
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {pf.profile.strategy === "smc"
                        ? `SMC top-down · risque ${pf.profile.riskPct ?? 2}% · TP1 50%+BE`
                        : `TF ${pf.profile.timeframe} · risque ${pf.profile.riskLevel}/5`}
                      {" · "}lev max {pf.profile.maxLeverage}× · R:R ≥{" "}
                      {pf.profile.minRR}
                      {" · "}
                      <span className="text-foreground">
                        WR{" "}
                        {winRatePct == null
                          ? "n/d"
                          : `${winRatePct.toFixed(0)} %`}
                      </span>
                      {" · "}
                      <span className="text-foreground">
                        {launched} trade{launched > 1 ? "s" : ""} lancé
                        {launched > 1 ? "s" : ""}
                      </span>
                      {" · "}
                      {pending.length + running.length} ouvert
                      {pending.length + running.length > 1 ? "s" : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <div className="text-right">
                      <p
                        className={`numeric text-sm font-semibold ${signedClass(delta)}`}
                      >
                        {pf.account.equityEur.toFixed(2)} €
                      </p>
                      <p className={`numeric text-[11px] ${signedClass(delta)}`}>
                        {delta >= 0 ? "+" : ""}
                        {delta.toFixed(2)} €
                      </p>
                    </div>
                    <ChevronDownIcon
                      className={`size-4 text-muted-foreground transition-transform ${
                        expanded ? "rotate-180" : ""
                      }`}
                    />
                  </div>
                </button>

                {expanded ? (
                  <div className="space-y-3 border-t border-white/8 px-4 py-3">
                    <div className="grid gap-2 sm:grid-cols-4 text-xs">
                      <Stat
                        label="Capital"
                        value={`${pf.profile.bankrollEur} €`}
                      />
                      <Stat
                        label="Marge / trade"
                        value={`${pf.profile.sizePct} %`}
                      />
                      <Stat
                        label="Winrate"
                        value={
                          winRatePct == null
                            ? "n/d"
                            : `${winRatePct.toFixed(0)} % (${wins.length}/${closed.length})`
                        }
                      />
                      <Stat
                        label="Trades lancés"
                        value={`${launched}`}
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {pf.profile.requireAiGate ? "Gate IA ON" : "Gate IA OFF"}
                      {" · "}
                      {pf.profile.maxSafetyMode
                        ? "Sureté max ON"
                        : "Sureté max OFF"}
                      {" · "}
                      Objectif {pf.profile.targetEur} €
                    </p>

                    {trades.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Aucun trade sur ce portefeuille pour l’instant.
                      </p>
                    ) : (
                      <div className="space-y-4">
                        <TradeCategory
                          title="En attente d’entrée"
                          trades={pending}
                          onClose={closeTrade}
                          onMirrorLive={
                            pf.profile.id === "boriaz" ||
                            pf.profile.strategy === "smc"
                              ? mirrorTradeToLive
                              : undefined
                          }
                        />
                        <TradeCategory
                          title="En cours"
                          trades={running}
                          onClose={closeTrade}
                          onMirrorLive={
                            pf.profile.id === "boriaz" ||
                            pf.profile.strategy === "smc"
                              ? mirrorTradeToLive
                              : undefined
                          }
                        />
                        <TradeCategory
                          title="TP"
                          trades={tps}
                        />
                        <TradeCategory
                          title="SL"
                          trades={sls}
                        />
                        {otherClosed.length > 0 ? (
                          <TradeCategory
                            title="Autres clôtures"
                            trades={otherClosed}
                          />
                        ) : null}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </section>

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
            Telegram. Compte {user?.name ?? "invité"} · {acc?.bankrollStartEur ?? 1000} €
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

      {heroTrade ? (
        <section
          className={`bb-reveal relative overflow-hidden rounded-[1.5rem] border px-4 py-5 sm:px-6 ${
            heroTrade.side === "short"
              ? "border-short/35 bg-short/8"
              : "border-long/35 bg-long/8"
          }`}
        >
          <p className="text-[0.65rem] tracking-[0.28em] text-muted-foreground uppercase">
            Trade figé · ne change plus avant TP/SL
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <CryptoLogo symbol={heroTrade.coin} size={44} />
            <div>
              <p className="font-heading text-2xl font-semibold tracking-tight">
                {heroTrade.side.toUpperCase()} {heroTrade.coin}
              </p>
              <p className="text-sm text-muted-foreground">
                Marge {heroTrade.marginEur.toFixed(0)} € sortie du solde · levier{" "}
                {heroTrade.leverage}× · notionnel {heroTrade.notionalEur.toFixed(0)} €
              </p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Level label="Spot live" value={heroTrade.markPx != null ? formatPx(heroTrade.markPx) : "—"} />
            <Level label="Entrée figée" value={formatPx(heroTrade.entry)} />
            <Level label="TP" value={formatPx(heroTrade.tp)} className="text-long" />
            <Level label="SL" value={formatPx(heroTrade.sl)} className="text-short" />
            <Level
              label="PnL"
              value={
                heroTrade.status === "pending"
                  ? "en attente"
                  : `${(heroTrade.pnlEur ?? 0) >= 0 ? "+" : ""}${(heroTrade.pnlEur ?? 0).toFixed(2)} €`
              }
              className={signedClass(heroTrade.pnlEur ?? 0)}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-xs">
            <span className="text-long">
              Si TP → +{(() => {
                const m = heroTrade.side === "long"
                  ? ((heroTrade.tp - heroTrade.entry) / heroTrade.entry) * 100
                  : ((heroTrade.entry - heroTrade.tp) / heroTrade.entry) * 100;
                return (heroTrade.marginEur * m * heroTrade.leverage / 100).toFixed(2);
              })()} €
            </span>
            <span className="text-short">
              Si SL → {(() => {
                const m = heroTrade.side === "long"
                  ? ((heroTrade.sl - heroTrade.entry) / heroTrade.entry) * 100
                  : ((heroTrade.entry - heroTrade.sl) / heroTrade.entry) * 100;
                return (heroTrade.marginEur * m * heroTrade.leverage / 100).toFixed(2);
              })()} €
            </span>
            <span className="text-muted-foreground">
              R:R {(() => {
                const reward = heroTrade.side === "long"
                  ? heroTrade.tp - heroTrade.entry
                  : heroTrade.entry - heroTrade.tp;
                const risk = heroTrade.side === "long"
                  ? heroTrade.entry - heroTrade.sl
                  : heroTrade.sl - heroTrade.entry;
                return risk > 0 ? (reward / risk).toFixed(1) : "∞";
              })()}
            </span>
            <span className="text-muted-foreground">
              frais {(heroTrade.feesEur ?? 0).toFixed(2)} €
            </span>
          </div>
          {!selectedCard ? (
          <div className="mt-4">
            <PriceChart
              coin={heroTrade.coin}
              interval="15m"
              allowToggle
              height={210}
              side={heroTrade.side}
              entryAt={heroTrade.filledAt ?? heroTrade.openedAt}
              entryPx={heroTrade.entry}
              exitAt={heroTrade.closedAt}
              exitPx={heroTrade.exitPx}
              tp={heroTrade.tp}
              sl={heroTrade.sl}
            />
          </div>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              Graphique trade masqué — crypto sélectionnée plus bas.
            </p>
          )}
          {heroTrade.status === "open" || heroTrade.status === "pending" ? (
            <button
              type="button"
              onClick={() => void closeTrade(heroTrade.id)}
              className="mt-3 rounded-lg border border-short/40 px-3 py-1.5 text-xs text-short transition-colors hover:bg-short/10"
            >
              Fermer maintenant (marché)
            </button>
          ) : null}
        </section>
      ) : data.best && data.best.action !== "wait" && data.best.confidence >= 55 ? (
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
          {data.best.aiVerifyNote ? (
            <p
              className={`mt-1 text-xs ${
                data.best.aiVerified ? "text-long" : "text-amber-200"
              }`}
            >
              {data.best.aiVerified ? "Gate IA ✓" : "Gate IA ✗"} ·{" "}
              {data.best.aiVerifyNote}
            </p>
          ) : null}
          {data.paperOpen?.[0]?.justification?.bullets?.length ? (
            <ul className="mt-3 space-y-1 rounded-lg bg-background/35 px-3 py-2 text-xs text-muted-foreground">
              <li className="font-medium text-foreground">
                Pourquoi ce trade a été lancé
              </li>
              {data.paperOpen[0].justification.bullets.slice(0, 6).map((b) => (
                <li key={b}>· {b}</li>
              ))}
            </ul>
          ) : null}
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

      <section className="bb-reveal space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-heading text-lg font-semibold">Cryptos</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Choisis une crypto dans la barre — détail et graphique en dessous.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["all", "Toutes"],
                ["long", "Long"],
                ["short", "Short"],
                ["wait", "Attendre"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setCryptoFilter(id)}
                className={`rounded-md border px-2.5 py-1 text-[11px] transition-colors ${
                  cryptoFilter === id
                    ? "border-primary/40 bg-primary/15 text-primary"
                    : "border-white/10 bg-white/5 text-muted-foreground hover:border-white/20"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="-mx-1 overflow-x-auto pb-1 [scrollbar-width:thin]">
          <div className="flex min-w-max gap-2 px-1">
            {filteredCards.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">
                Aucune crypto pour ce filtre.
              </p>
            ) : (
              filteredCards.map((card) => {
                const active = card.coin === activeCoin;
                return (
                  <button
                    key={card.coin}
                    type="button"
                    onClick={() => setSelectedCoin(card.coin)}
                    className={`flex min-w-[7.5rem] items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                      active
                        ? "border-primary/45 bg-primary/12"
                        : "border-white/10 bg-card/40 hover:border-white/20 hover:bg-card/70"
                    }`}
                  >
                    <CryptoLogo symbol={card.coin} size={28} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium leading-tight">
                        {card.label}
                      </p>
                      <p
                        className={`text-[10px] leading-tight ${
                          card.direction === "long"
                            ? "text-long"
                            : card.direction === "short"
                              ? "text-short"
                              : "text-muted-foreground"
                        }`}
                      >
                        {card.direction === "wait"
                          ? "Attendre"
                          : card.direction.toUpperCase()}
                        {card.alignment
                          ? ` · ${card.alignment.score}`
                          : ""}
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {selectedCard ? (
          <article className="rounded-2xl border border-white/10 bg-card/50 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <CryptoLogo symbol={selectedCard.coin} size={48} />
                <div>
                  <p className="font-heading text-xl font-semibold tracking-tight sm:text-2xl">
                    {selectedCard.label}
                  </p>
                  <p className="numeric text-2xl font-medium">
                    {formatPx(selectedCard.price)}
                  </p>
                </div>
              </div>
              {selectedCard.alignment ? (
                <AlignBadge
                  score={selectedCard.alignment.score}
                  label={selectedCard.alignment.label}
                />
              ) : null}
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge
                variant="outline"
                className={
                  selectedCard.direction === "long"
                    ? "border-long/40 bg-long/10 text-long"
                    : selectedCard.direction === "short"
                      ? "border-short/40 bg-short/10 text-short"
                      : ""
                }
              >
                {selectedCard.direction === "wait"
                  ? "Attendre"
                  : selectedCard.direction.toUpperCase()}
              </Badge>
              {selectedCard.entryMode ? (
                <Badge variant="outline" className="text-[10px]">
                  {selectedCard.entryMode === "limit_wait" ? "Limite" : "Marché"}
                </Badge>
              ) : null}
              {selectedCard.confidence > 0 ? (
                <Badge variant="outline" className="text-[10px]">
                  Conf. {selectedCard.confidence}
                </Badge>
              ) : null}
            </div>

            {selectedCard.entryMode === "limit_wait" ? (
              <p className="mt-2 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-sm text-amber-50">
                Attendre le fill limite
                {selectedCard.entry != null ? ` @ ${formatPx(selectedCard.entry)}` : ""}
                {" — "}ne pas entrer au marché si le prix n’est pas là.
                {selectedCard.entryHint ? ` ${selectedCard.entryHint}` : ""}
              </p>
            ) : selectedCard.entryMode === "market_now" ? (
              <p className="mt-2 rounded-lg border border-long/25 bg-long/10 px-3 py-2 text-sm">
                Entrée marché possible maintenant
                {selectedCard.entry != null ? ` vers ${formatPx(selectedCard.entry)}` : ""}.
                {selectedCard.entryHint ? ` ${selectedCard.entryHint}` : ""}
              </p>
            ) : selectedCard.direction === "wait" && selectedCard.confidence === 0 ? (
              <p className="mt-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-muted-foreground">
                {data.signalsPending
                  ? "Analyse encore en cours pour cette crypto — pas un signal WAIT définitif."
                  : "Pas de setup clair pour l’instant."}
              </p>
            ) : null}

            {selectedCard.alignment ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {selectedCard.alignment.breakdown}
              </p>
            ) : null}

            {(selectedCard.direction === "long" ||
              selectedCard.direction === "short") &&
            (selectedCard.entry || selectedCard.tp || selectedCard.sl) ? (
              <div className="mt-4 grid grid-cols-3 gap-2 text-sm sm:grid-cols-5">
                <div className="rounded-lg bg-muted/25 px-2.5 py-2">
                  <p className="text-[11px] text-muted-foreground">Entrée</p>
                  <p className="numeric font-medium">
                    {selectedCard.entry != null
                      ? formatPx(selectedCard.entry)
                      : "—"}
                  </p>
                </div>
                <div className="rounded-lg bg-muted/25 px-2.5 py-2">
                  <p className="text-[11px] text-muted-foreground">TP</p>
                  <p className="numeric font-medium text-long">
                    {selectedCard.tp != null ? formatPx(selectedCard.tp) : "—"}
                  </p>
                </div>
                <div className="rounded-lg bg-muted/25 px-2.5 py-2">
                  <p className="text-[11px] text-muted-foreground">SL</p>
                  <p className="numeric font-medium text-short">
                    {selectedCard.sl != null ? formatPx(selectedCard.sl) : "—"}
                  </p>
                </div>
                <div className="rounded-lg bg-muted/25 px-2.5 py-2">
                  <p className="text-[11px] text-muted-foreground">15m</p>
                  <p
                    className={`numeric font-medium ${
                      selectedCard.change15mPct === null
                        ? ""
                        : signedClass(selectedCard.change15mPct)
                    }`}
                  >
                    {selectedCard.change15mPct === null
                      ? "n/d"
                      : formatPct(selectedCard.change15mPct, 2)}
                  </p>
                </div>
                <div className="rounded-lg bg-muted/25 px-2.5 py-2">
                  <p className="text-[11px] text-muted-foreground">2h</p>
                  <p
                    className={`numeric font-medium ${
                      selectedCard.change2hPct === null
                        ? ""
                        : signedClass(selectedCard.change2hPct)
                    }`}
                  >
                    {selectedCard.change2hPct === null
                      ? "n/d"
                      : formatPct(selectedCard.change2hPct, 2)}
                  </p>
                </div>
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-lg bg-muted/25 px-2.5 py-2">
                  <p className="text-[11px] text-muted-foreground">15m</p>
                  <p
                    className={`numeric font-medium ${
                      selectedCard.change15mPct === null
                        ? ""
                        : signedClass(selectedCard.change15mPct)
                    }`}
                  >
                    {selectedCard.change15mPct === null
                      ? "n/d"
                      : formatPct(selectedCard.change15mPct, 2)}
                  </p>
                </div>
                <div className="rounded-lg bg-muted/25 px-2.5 py-2">
                  <p className="text-[11px] text-muted-foreground">2h</p>
                  <p
                    className={`numeric font-medium ${
                      selectedCard.change2hPct === null
                        ? ""
                        : signedClass(selectedCard.change2hPct)
                    }`}
                  >
                    {selectedCard.change2hPct === null
                      ? "n/d"
                      : formatPct(selectedCard.change2hPct, 2)}
                  </p>
                </div>
              </div>
            )}

            {selectedCard.alignment?.divergence ? (
              <p className="mt-2 text-xs text-amber-200">
                {selectedCard.alignment.divergence}
              </p>
            ) : null}

            {true && selectedCard.tfSummary ? (
              <p className="mt-2 text-xs text-muted-foreground">
                TF {selectedCard.tfSummary}
              </p>
            ) : null}

            <div className="mt-4">
              <PriceChart
                coin={selectedCard.coin}
                interval="15m"
                allowToggle
                height={200}
                side={
                  selectedCard.direction === "long" ||
                  selectedCard.direction === "short"
                    ? selectedCard.direction
                    : null
                }
                entryPx={selectedCard.entry}
                tp={selectedCard.tp}
                sl={selectedCard.sl}
              />
            </div>

            <p className="mt-3 text-sm text-muted-foreground">
              {selectedCard.blurb}
            </p>
          </article>
        ) : null}
      </section>


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

function tradeStatusLabel(status: PaperTrade["status"]): string {
  switch (status) {
    case "pending":
      return "En attente d’entrée";
    case "open":
      return "En cours";
    case "tp":
      return "TP";
    case "sl":
      return "SL";
    case "closed_manual":
      return "Manuel";
    case "expired":
      return "Expiré";
    case "invalidated":
      return "Invalidé";
    default:
      return status;
  }
}

function TradeCategory({
  title,
  trades,
  onClose,
  onMirrorLive,
}: {
  title: string;
  trades: PaperTrade[];
  onClose?: (id: string) => void;
  onMirrorLive?: (id: string) => void;
}) {
  if (trades.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {title}
        <span className="ml-1.5 text-foreground/70">({trades.length})</span>
      </p>
      <div className="space-y-2">
        {trades.map((t) => (
          <PortfolioTradeRow
            key={t.id}
            trade={t}
            onClose={onClose}
            onMirrorLive={onMirrorLive}
          />
        ))}
      </div>
    </div>
  );
}

function PortfolioTradeRow({
  trade: t,
  onClose,
  onMirrorLive,
}: {
  trade: PaperTrade;
  onClose?: (id: string) => void;
  onMirrorLive?: (id: string) => void;
}) {
  const [openWhy, setOpenWhy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [mirroring, setMirroring] = useState(false);
  const canClose = t.status === "open" || t.status === "pending";
  const canMirror =
    Boolean(onMirrorLive) &&
    canClose &&
    (t.portfolioId === "boriaz" || t.strategy === "smc") &&
    !/LIVE HL/i.test(t.note || "");
  const takenAt = t.filledAt ?? t.openedAt;
  const tpEur = (() => {
    const move =
      t.side === "long"
        ? ((t.tp - t.entry) / t.entry) * 100
        : ((t.entry - t.tp) / t.entry) * 100;
    return (t.marginEur * move * t.leverage) / 100;
  })();
  const slEur = (() => {
    const move =
      t.side === "long"
        ? ((t.sl - t.entry) / t.entry) * 100
        : ((t.entry - t.sl) / t.entry) * 100;
    return (t.marginEur * move * t.leverage) / 100;
  })();
  const rr = (() => {
    const reward =
      t.side === "long" ? t.tp - t.entry : t.entry - t.tp;
    const risk =
      t.side === "long" ? t.entry - t.sl : t.sl - t.entry;
    return risk > 0 ? reward / risk : 0;
  })();

  return (
    <div className="rounded-xl border border-white/8 bg-background/35 px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <CryptoLogo symbol={t.coin} size={28} />
          <div>
            <p className="text-sm font-semibold">
              <span
                className={t.side === "long" ? "text-long" : "text-short"}
              >
                {t.side.toUpperCase()}
              </span>{" "}
              {t.coin}
              <span className="ml-2 text-[10px] font-normal uppercase text-muted-foreground">
                {tradeStatusLabel(t.status)}
              </span>
            </p>
            <p className="numeric text-[11px] text-muted-foreground">
              Entrée {formatPx(t.entry)} · spot{" "}
              {t.markPx != null ? formatPx(t.markPx) : "—"} · TP{" "}
              {formatPx(t.tp)} · SL {formatPx(t.sl)}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Pris{" "}
              <span className="text-foreground">
                {formatParisDateTime(takenAt)}
              </span>
              {t.status === "pending" ? " (limite)" : null}
              {t.closedAt ? (
                <>
                  {" · "}Arrêté{" "}
                  <span className="text-foreground">
                    {formatParisDateTime(t.closedAt)}
                  </span>
                </>
              ) : null}
              <span className="ml-1 text-[10px] opacity-70">heure FR</span>
            </p>
          </div>
        </div>
        <div className="text-right text-xs">
          <p className={`numeric font-semibold ${signedClass(t.pnlEur ?? 0)}`}>
            {t.status === "pending"
              ? "en attente"
              : `${(t.pnlEur ?? 0) >= 0 ? "+" : ""}${(t.pnlEur ?? 0).toFixed(2)} €`}
          </p>
          <p className="text-muted-foreground">
            {t.leverage}× · marge {t.marginEur.toFixed(0)} € · frais{" "}
            {(t.feesEur ?? 0).toFixed(2)} € · R:R {rr.toFixed(1)}
          </p>
          <p>
            <span className="text-long">Si TP +{tpEur.toFixed(2)} €</span>
            {" · "}
            <span className="text-short">Si SL {slEur.toFixed(2)} €</span>
          </p>
          {canClose ? (
            <div className="mt-1 flex flex-wrap justify-end gap-1.5">
              {canMirror ? (
                <button
                  type="button"
                  disabled={mirroring}
                  onClick={() => {
                    setMirroring(true);
                    void Promise.resolve(onMirrorLive?.(t.id)).finally(() =>
                      setMirroring(false),
                    );
                  }}
                  className="rounded-md border border-amber-500/50 px-2 py-0.5 text-[11px] text-amber-400 transition-colors hover:bg-amber-500/10 disabled:opacity-50"
                >
                  {mirroring ? "LIVE…" : "Copier → LIVE (marché)"}
                </button>
              ) : null}
              {onClose ? (
                <button
                  type="button"
                  disabled={closing}
                  onClick={() => {
                    setClosing(true);
                    onClose(t.id);
                  }}
                  className="rounded-md border border-short/40 px-2 py-0.5 text-[11px] text-short transition-colors hover:bg-short/10 disabled:opacity-50"
                >
                  {closing ? "Clôture…" : "Fermer maintenant"}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <div className="mt-2.5">
        <PriceChart
          coin={t.coin}
          interval="15m"
          allowToggle
          height={190}
          side={t.side}
          entryAt={takenAt}
          entryPx={t.entry}
          exitAt={t.closedAt}
          exitPx={t.exitPx}
          tp={t.tp}
          sl={t.sl}
        />
      </div>
      {(t.status === "open" || t.status === "pending") && (
        <TradeLiveReview trade={t} />
      )}
      {(t.justification?.summary || t.note) && (
        <div className="mt-2">
          <button
            type="button"
            className="flex items-center gap-1 text-[11px] text-primary"
            onClick={() => setOpenWhy((v) => !v)}
          >
            Pourquoi ce trade
            <ChevronDownIcon
              className={`size-3.5 transition-transform ${openWhy ? "rotate-180" : ""}`}
            />
          </button>
          {openWhy ? (
            <div className="mt-1 space-y-1 rounded-lg bg-muted/20 px-2 py-1.5 text-[11px] text-muted-foreground">
              <p className="text-foreground">
                {t.justification?.summary || t.note}
              </p>
              {(t.justification?.bullets ?? []).map((b) => (
                <p key={b}>· {b}</p>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function AccountBox({
  user,
  onUser,
}: {
  user: SessionUser | null;
  onUser: (u: SessionUser) => void;
}) {
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(action: "register" | "login") {
    setMsg(null);
    const res = await fetch("/api/account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, name, pin }),
    });
    const json = await readResponseJson<{ error?: string; user?: SessionUser }>(res);
    if (!res.ok) {
      setMsg(json.error || "Échec");
      return;
    }
    if (json.user) onUser(json.user);
    setMsg(action === "register" ? "Compte créé — tes trades restent." : "Connecté.");
  }

  return (
    <div className="min-w-[14rem] rounded-xl border border-white/10 bg-background/40 p-3">
      <p className="text-[10px] tracking-wide text-muted-foreground uppercase">
        {user?.guest === false ? `Connecté · ${user.name}` : "Créer / retrouver mon compte"}
      </p>
      <div className="mt-2 flex flex-col gap-1.5">
        <input
          className="h-8 rounded-md border border-white/10 bg-background px-2 text-sm"
          placeholder="Pseudo"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className="h-8 rounded-md border border-white/10 bg-background px-2 text-sm"
          placeholder="Code 4 chiffres"
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
        />
        <div className="flex gap-1.5">
          <Button size="sm" onClick={() => void submit("register")}>
            Créer
          </Button>
          <Button size="sm" variant="outline" onClick={() => void submit("login")}>
            Entrer
          </Button>
        </div>
        {msg ? <p className="text-[11px] text-primary">{msg}</p> : null}
      </div>
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
