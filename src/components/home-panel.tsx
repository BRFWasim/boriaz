"use client";

import { useEffect, useState } from "react";
import { CryptoLogo } from "@/components/crypto-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatPct, formatPx, signedClass } from "@/lib/format";
import type { HomePayload } from "@/lib/home";
import type { PaperAccount, PaperTrade } from "@/lib/user-types";
import { syncPaperFromBrowser, writeLocalPaper } from "@/lib/paper-local";

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
  const [loading, setLoading] = useState(true);
  const [liveAt, setLiveAt] = useState<number | null>(null);

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
        const json = await res.json();
        if (!res.ok || !alive) return;
        setAccount(json.account);
        if (Array.isArray(json.paper)) mergePaper(json.paper);
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
  const openTrades = paperLive.filter(
    (t) => t.status === "open" || t.status === "pending",
  );
  const heroTrade = openTrades[0] ?? null;
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

      {acc ? (
        <section
          className="bb-reveal rounded-[1.5rem] border border-primary/25 bg-primary/5 px-4 py-5 sm:px-6"
          style={{ animationDelay: "80ms" }}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[0.65rem] tracking-[0.28em] text-primary uppercase">
                Compte simu 1000 € · {user?.guest === false ? user.name : user?.name ?? "invité"}
              </p>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                Plusieurs trades en même temps sur le même capital. Un trade reste
                figé (entrée / TP / SL / côté) jusqu’au TP ou SL — il ne change
                plus de stratégie. Refresh = tout reste.
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

          <p className="mt-5 text-[0.65rem] tracking-[0.22em] text-muted-foreground uppercase">
            Portefeuilles
          </p>
          {data.portfolios?.length ? (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {data.portfolios.map((pf) => (
                <div
                  key={pf.profile.id}
                  className="rounded-xl border border-white/8 bg-background/30 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">
                      {pf.profile.name}
                      {pf.profile.isDefault ? (
                        <span className="ml-2 text-[10px] text-primary uppercase">
                          défaut
                        </span>
                      ) : null}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      TF {pf.profile.timeframe} · risque {pf.profile.riskLevel}/5
                    </p>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-3 text-xs">
                    <span>
                      Equity{" "}
                      <strong className={signedClass(pf.account.equityEur - pf.account.bankrollStartEur)}>
                        {pf.account.equityEur.toFixed(2)} €
                      </strong>
                    </span>
                    <span>
                      Δ{" "}
                      <strong className={signedClass(pf.account.equityEur - pf.account.bankrollStartEur)}>
                        {(pf.account.equityEur - pf.account.bankrollStartEur >= 0 ? "+" : "")}
                        {(pf.account.equityEur - pf.account.bankrollStartEur).toFixed(2)} €
                      </strong>
                    </span>
                    <span className="text-muted-foreground">
                      {pf.openTrades.length} ouvert
                      {pf.openTrades.length > 1 ? "s" : ""}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <p className="mt-5 text-[0.65rem] tracking-[0.22em] text-muted-foreground uppercase">
            Carnet — trades proposés / ouverts / clos
          </p>
          {paperLive.length > 0 ? (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[44rem] text-left text-sm">
                <thead className="text-[10px] tracking-wide text-muted-foreground uppercase">
                  <tr>
                    <th className="py-2 pr-2">Coin</th>
                    <th className="py-2 pr-2">Portefeuille</th>
                    <th className="py-2 pr-2">Côté</th>
                    <th className="py-2 pr-2">Lev.</th>
                    <th className="py-2 pr-2">Marge</th>
                    <th className="py-2 pr-2">Entrée</th>
                    <th className="py-2 pr-2">Spot</th>
                    <th className="py-2 pr-2">TP</th>
                    <th className="py-2 pr-2">SL</th>
                    <th className="py-2 pr-2">PnL</th>
                    <th className="py-2 pr-2">Si TP</th>
                    <th className="py-2 pr-2">Si SL</th>
                    <th className="py-2">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {paperLive.map((t) => (
                    <tr key={t.id} className="border-t border-white/8 align-top">
                      <td className="py-2.5 pr-2">
                        <span className="inline-flex items-center gap-2 font-medium">
                          <CryptoLogo symbol={t.coin} size={22} />
                          {t.coin}
                        </span>
                        {t.justification?.summary ? (
                          <p className="mt-1 max-w-[14rem] text-[10px] leading-snug text-muted-foreground">
                            {t.justification.summary}
                          </p>
                        ) : t.note ? (
                          <p className="mt-1 max-w-[14rem] text-[10px] leading-snug text-muted-foreground">
                            {t.note}
                          </p>
                        ) : null}
                      </td>
                      <td className="py-2.5 pr-2 text-xs text-muted-foreground">
                        {t.portfolioName || "Défaut"}
                      </td>
                      <td
                        className={`py-2.5 pr-2 font-semibold ${
                          t.side === "long" ? "text-long" : "text-short"
                        }`}
                      >
                        {t.side.toUpperCase()}
                      </td>
                      <td className="numeric py-2.5 pr-2">{t.leverage}×</td>
                      <td className="numeric py-2.5 pr-2">
                        {t.marginEur.toFixed(0)} €
                      </td>
                      <td className="numeric py-2.5 pr-2">{formatPx(t.entry)}</td>
                      <td className="numeric py-2.5 pr-2">
                        {t.markPx != null ? formatPx(t.markPx) : "—"}
                      </td>
                      <td className="numeric py-2.5 pr-2 text-long">
                        {formatPx(t.tp)}
                      </td>
                      <td className="numeric py-2.5 pr-2 text-short">
                        {formatPx(t.sl)}
                      </td>
                      <td
                        className={`numeric py-2.5 pr-2 font-semibold ${signedClass(t.pnlEur ?? 0)}`}
                      >
                        {t.status === "pending"
                          ? "—"
                          : `${(t.pnlEur ?? 0) >= 0 ? "+" : ""}${(t.pnlEur ?? 0).toFixed(2)} €`}
                      </td>
                      <td className="numeric py-2.5 pr-2 text-long">
                        {(() => {
                          const move =
                            t.side === "long"
                              ? ((t.tp - t.entry) / t.entry) * 100
                              : ((t.entry - t.tp) / t.entry) * 100;
                          return `+${(t.marginEur * move * t.leverage / 100).toFixed(2)} €`;
                        })()}
                      </td>
                      <td className="numeric py-2.5 pr-2 text-short">
                        {(() => {
                          const move =
                            t.side === "long"
                              ? ((t.sl - t.entry) / t.entry) * 100
                              : ((t.entry - t.sl) / t.entry) * 100;
                          return `${(t.marginEur * move * t.leverage / 100).toFixed(2)} €`;
                        })()}
                      </td>
                      <td className="py-2.5 text-xs uppercase text-muted-foreground">
                        {t.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              Aucun trade encore — le prochain signal figera une ligne ici.
            </p>
          )}
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
          </div>
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
    const json = await res.json();
    if (!res.ok) {
      setMsg(json.error || "Échec");
      return;
    }
    onUser(json.user);
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
