"use client";

import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPct, formatPx, signedClass } from "@/lib/format";
import type {
  JournalEntry,
  PaperAccount,
  PaperTrade,
  PortfolioProfile,
  UserPrefs,
} from "@/lib/user-types";
import type { BacktestPayload } from "@/lib/backtest";
import type { CorrelationPayload } from "@/lib/correlation";
import {
  DEFAULT_PREFS,
  ensurePortfolios,
  makeCustomPortfolio,
} from "@/lib/user-types";
import { syncPaperFromBrowser, writeLocalPaper } from "@/lib/paper-local";

const PREFS_LS_KEY = "boriazbot-prefs-v1";

export function LabPanel() {
  const [prefs, setPrefs] = useState<UserPrefs | null>(null);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [paper, setPaper] = useState<PaperTrade[]>([]);
  const [account, setAccount] = useState<PaperAccount | null>(null);
  const [corr, setCorr] = useState<CorrelationPayload | null>(null);
  const [bt, setBt] = useState<BacktestPayload | null>(null);
  const [status, setStatus] = useState<{
    keys: Record<string, boolean>;
    missing: string[];
    storage: string;
    vercelEnvUrl: string;
    upstashUrl: string;
    howto: { where: string; upstash: string };
  } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const dirtyRef = useRef(false);

  function patchPrefs(next: UserPrefs) {
    dirtyRef.current = true;
    setPrefs(next);
    try {
      localStorage.setItem(PREFS_LS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  async function refresh(opts?: { forcePrefs?: boolean }) {
    try {
      const [p, j, pa, c] = await Promise.all([
        fetch("/api/prefs").then((r) => r.json()),
        fetch("/api/journal").then((r) => r.json()),
        fetch("/api/paper").then((r) => r.json()),
        fetch("/api/correlation").then((r) => r.json()),
      ]);
      if (!dirtyRef.current || opts?.forcePrefs) {
        const serverPrefs = {
          ...DEFAULT_PREFS,
          ...(p.prefs ?? {}),
          portfolios: ensurePortfolios(p.prefs?.portfolios),
        } as UserPrefs;
        setPrefs(serverPrefs);
        dirtyRef.current = false;
      }
      setJournal(j.entries ?? []);
      setPaper(pa.trades ?? []);
      setAccount(pa.account ?? null);
      if (pa.trades) writeLocalPaper(pa.trades);
      if (!c.error || c.latest) setCorr(c);
      const st = await fetch("/api/status").then((r) => r.json());
      setStatus(st);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Erreur lab");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREFS_LS_KEY);
      if (raw) {
        const local = JSON.parse(raw) as UserPrefs;
        dirtyRef.current = true;
        setPrefs({
          ...DEFAULT_PREFS,
          ...local,
          portfolios: ensurePortfolios(local.portfolios),
        });
      }
    } catch {
      /* ignore */
    }
    void syncPaperFromBrowser().then(() => void refresh());
    const id = window.setInterval(() => void refresh(), 12_000);
    return () => window.clearInterval(id);
  }, []);

  async function savePrefs() {
    if (!prefs) return;
    setSaving(true);
    setMsg("Enregistrement…");
    const payload = {
      ...prefs,
      portfolios: ensurePortfolios(prefs.portfolios),
    };
    const res = await fetch("/api/prefs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (res.ok) {
      dirtyRef.current = false;
      const next = {
        ...DEFAULT_PREFS,
        ...json.prefs,
        portfolios: ensurePortfolios(json.prefs?.portfolios),
      } as UserPrefs;
      setPrefs(next);
      try {
        localStorage.setItem(PREFS_LS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      setMsg("Préférences & portefeuilles enregistrés ✓");
    } else {
      setMsg(json.error || "Échec sauvegarde");
    }
    setSaving(false);
  }

  function updatePortfolio(id: string, patch: Partial<PortfolioProfile>) {
    if (!prefs) return;
    const portfolios = ensurePortfolios(prefs.portfolios).map((p) =>
      p.id === id ? { ...p, ...patch, id: p.id, isDefault: p.isDefault } : p,
    );
    patchPrefs({ ...prefs, portfolios });
  }

  function addPortfolio(kind: "scalp" | "risky" | "swing") {
    if (!prefs) return;
    const preset =
      kind === "scalp"
        ? makeCustomPortfolio({
            name: "Scalp 1h",
            timeframe: "1h",
            riskLevel: 4,
            maxLeverage: 5,
            minRR: 1.2,
            tradesPerDay: 12,
            sizePct: 8,
            maxSafetyMode: false,
          })
        : kind === "risky"
          ? makeCustomPortfolio({
              name: "Risqué (rentable)",
              timeframe: "1h",
              riskLevel: 4,
              maxLeverage: 5,
              minRR: 1.8,
              tradesPerDay: 6,
              sizePct: 8,
              maxLossEur: 120,
              targetEur: 250,
              maxSafetyMode: false,
              requireAiGate: true,
            })
          : makeCustomPortfolio({
              name: "Swing 1d",
              timeframe: "1d",
              riskLevel: 2,
              maxLeverage: 2,
              minRR: 2,
              tradesPerDay: 3,
              sizePct: 10,
              maxSafetyMode: true,
            });
    patchPrefs({
      ...prefs,
      portfolios: ensurePortfolios([...prefs.portfolios, preset]),
    });
  }

  function removePortfolio(id: string) {
    if (!prefs || id === "default") return;
    patchPrefs({
      ...prefs,
      portfolios: ensurePortfolios(
        prefs.portfolios.filter((p) => p.id !== id),
      ),
    });
  }

  async function runBacktest(days: number) {
    setMsg("Backtest en cours…");
    const res = await fetch(`/api/backtest?days=${days}`, { cache: "no-store" });
    const json = await res.json();
    if (!res.ok) {
      setMsg(json.error || "Backtest échoué");
      return;
    }
    setBt(json);
    setMsg(null);
  }

  if (loading && !prefs) {
    return (
      <p className="animate-pulse text-sm text-muted-foreground">
        Chargement lab…
      </p>
    );
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-xl font-semibold">Lab · BoriazBot</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Zone d’atelier : mesurer la qualité des signaux sans risque réel,
          comprendre le macro, et régler le bot.
        </p>
        {msg ? <p className="mt-2 text-sm text-primary">{msg}</p> : null}
      </section>

      {status ? (
        <section className="rounded-2xl border border-primary/25 bg-primary/5 p-4">
          <h3 className="font-medium">Clés — où les mettre</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Tout va dans <strong className="text-foreground">Vercel → Environment Variables</strong>{" "}
            (secrets, Environment = Production). Pas dans le chat. Pas dans
            « Configuration » générique.
          </p>
          <p className="mt-2 text-sm">
            <a
              className="text-primary underline underline-offset-2"
              href={status.vercelEnvUrl}
              target="_blank"
              rel="noreferrer"
            >
              Ouvrir les variables de boriazbot-v4
            </a>
          </p>
          <p className="mt-3 text-sm text-muted-foreground">{status.howto.upstash}</p>
          <p className="mt-1 text-sm">
            <a
              className="text-primary underline underline-offset-2"
              href={status.upstashUrl}
              target="_blank"
              rel="noreferrer"
            >
              Créer le tiroir Upstash (gratuit)
            </a>
          </p>
          <ul className="mt-3 grid gap-1 text-xs sm:grid-cols-2">
            {Object.entries(status.keys).map(([name, ok]) => (
              <li key={name} className={ok ? "text-long" : "text-short"}>
                {ok ? "OK" : "MANQUE"} · {name}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            Stockage actuel : {status.storage === "upstash" ? "Upstash (persistant)" : "/tmp (éphémère)"}
          </p>
        </section>
      ) : null}

      <section className="rounded-2xl border border-border/80 bg-card/60 p-4">
        <h3 className="font-medium">Paper trade — c’est quoi ?</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Un <span className="text-foreground">compte virtuel de 1000 €</span> qui
          suit automatiquement chaque signal Telegram/accueil comme si tu
          l’avais pris. Ça sert à voir si les setups sont bons{" "}
          <em>avant</em> de risquer de l’argent réel. Ce n’est pas un vrai
          ordre sur Hyperliquid.
        </p>
        {account ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            <Metric label="Départ" value={`${account.bankrollStartEur} €`} />
            <Metric
              label="Equity"
              value={`${account.equityEur.toFixed(2)} €`}
            />
            <Metric
              label="Réalisé"
              value={`${account.realizedPnlEur.toFixed(2)} €`}
            />
            <Metric
              label="Latent"
              value={`${account.unrealizedPnlEur.toFixed(2)} €`}
            />
          </div>
        ) : null}
        <p className="mt-2 text-xs text-muted-foreground">
          Equity = cash libre + marges ouvertes + PnL latent. Marge par trade ≈
          % du capital × levier pour le notionnel. Ouverts {account?.openCount ?? 0}{" "}
          · en attente limite {account?.pendingCount ?? 0} · clos{" "}
          {account?.closedCount ?? 0} (W{account?.winCount ?? 0}/L
          {account?.lossCount ?? 0}).
        </p>
      </section>

      {prefs ? (
        <section className="rounded-2xl border border-border/80 bg-card/60 p-4">
          <h3 className="font-medium">Préférences globales</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Telegram, hush hours, watchlist. Les paramètres de trading sont
            par portefeuille (ci-dessous). Clique <strong>Enregistrer</strong>
            — le refresh auto n’écrase plus tes edits.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <Label htmlFor="hushS">Hush hours début (UTC)</Label>
              <Input
                id="hushS"
                type="number"
                min={0}
                max={23}
                value={prefs.hushHoursStart}
                onChange={(e) =>
                  patchPrefs({
                    ...prefs,
                    hushHoursStart: Number(e.target.value),
                  })
                }
              />
            </div>
            <div>
              <Label htmlFor="hushE">Hush hours fin (UTC)</Label>
              <Input
                id="hushE"
                type="number"
                min={0}
                max={23}
                value={prefs.hushHoursEnd}
                onChange={(e) =>
                  patchPrefs({ ...prefs, hushHoursEnd: Number(e.target.value) })
                }
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="coins">Cryptos suivies (virgules)</Label>
              <Input
                id="coins"
                value={prefs.watchCoins.join(", ")}
                onChange={(e) =>
                  patchPrefs({
                    ...prefs,
                    watchCoins: e.target.value
                      .split(",")
                      .map((c) => c.trim().toUpperCase())
                      .filter(Boolean),
                  })
                }
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={prefs.telegramEnabled}
                onChange={(e) =>
                  patchPrefs({ ...prefs, telegramEnabled: e.target.checked })
                }
              />
              Telegram activé
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={prefs.paperTradeEnabled}
                onChange={(e) =>
                  patchPrefs({ ...prefs, paperTradeEnabled: e.target.checked })
                }
              />
              Paper trade auto (tous portefeuilles)
            </label>
          </div>
        </section>
      ) : null}

      {prefs ? (
        <section className="rounded-2xl border border-primary/25 bg-primary/5 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-medium">Portefeuilles paper</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                <strong className="text-foreground">Défaut</strong> toujours
                présent. Ajoute un perso (scalp 1h, risqué, swing…) — chaque
                portefeuille a son capital, TF, R:R, risque. Visible à
                l’Accueil.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => addPortfolio("scalp")}>
                + Scalp 1h
              </Button>
              <Button size="sm" variant="outline" onClick={() => addPortfolio("risky")}>
                + Risqué (rentable)
              </Button>
              <Button size="sm" variant="outline" onClick={() => addPortfolio("swing")}>
                + Swing 1d
              </Button>
            </div>
          </div>

          <div className="mt-4 space-y-4">
            {ensurePortfolios(prefs.portfolios).map((pf) => (
              <div
                key={pf.id}
                className="rounded-xl border border-border/70 bg-card/70 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      className="h-8 max-w-[12rem]"
                      value={pf.name}
                      disabled={pf.isDefault}
                      onChange={(e) =>
                        updatePortfolio(pf.id, { name: e.target.value })
                      }
                    />
                    {pf.isDefault ? (
                      <Badge variant="outline">Obligatoire</Badge>
                    ) : null}
                    <label className="flex items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={pf.enabled}
                        disabled={pf.isDefault}
                        onChange={(e) =>
                          updatePortfolio(pf.id, { enabled: e.target.checked })
                        }
                      />
                      Actif
                    </label>
                    <label className="flex items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={pf.paperTradeEnabled}
                        onChange={(e) =>
                          updatePortfolio(pf.id, {
                            paperTradeEnabled: e.target.checked,
                          })
                        }
                      />
                      Paper auto
                    </label>
                  </div>
                  {!pf.isDefault ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => removePortfolio(pf.id)}
                    >
                      Supprimer
                    </Button>
                  ) : null}
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <Label>Capital (€)</Label>
                    <Input
                      type="number"
                      min={100}
                      value={pf.bankrollEur}
                      onChange={(e) =>
                        updatePortfolio(pf.id, {
                          bankrollEur: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                  <div>
                    <Label>Horizon TF</Label>
                    <select
                      className="flex h-8 w-full rounded-lg border border-border bg-background px-2 text-sm"
                      value={pf.timeframe}
                      onChange={(e) =>
                        updatePortfolio(pf.id, {
                          timeframe: e.target.value as PortfolioProfile["timeframe"],
                        })
                      }
                    >
                      <option value="15m">Très court (15m→1h)</option>
                      <option value="1h">Court terme 1h</option>
                      <option value="4h">Moyen 4h</option>
                      <option value="1d">Swing 1d</option>
                    </select>
                  </div>
                  <div>
                    <Label>Risque 1–5</Label>
                    <Input
                      type="number"
                      min={1}
                      max={5}
                      value={pf.riskLevel}
                      onChange={(e) =>
                        updatePortfolio(pf.id, {
                          riskLevel: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                  <div>
                    <Label>Levier max</Label>
                    <Input
                      type="number"
                      min={1}
                      max={10}
                      value={pf.maxLeverage}
                      onChange={(e) =>
                        updatePortfolio(pf.id, {
                          maxLeverage: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                  <div>
                    <Label>Marge / trade (%)</Label>
                    <Input
                      type="number"
                      min={1}
                      max={15}
                      value={pf.sizePct}
                      onChange={(e) =>
                        updatePortfolio(pf.id, {
                          sizePct: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                  <div>
                    <Label>R:R min</Label>
                    <Input
                      type="number"
                      step="0.1"
                      min={0.5}
                      value={pf.minRR}
                      onChange={(e) =>
                        updatePortfolio(pf.id, {
                          minRR: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                  <div>
                    <Label>Trades / jour</Label>
                    <Input
                      type="number"
                      min={0}
                      max={50}
                      value={pf.tradesPerDay}
                      onChange={(e) =>
                        updatePortfolio(pf.id, {
                          tradesPerDay: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                  <div>
                    <Label>Perte max (€)</Label>
                    <Input
                      type="number"
                      min={10}
                      value={pf.maxLossEur}
                      onChange={(e) =>
                        updatePortfolio(pf.id, {
                          maxLossEur: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                  <div>
                    <Label>Objectif (€)</Label>
                    <Input
                      type="number"
                      min={10}
                      value={pf.targetEur}
                      onChange={(e) =>
                        updatePortfolio(pf.id, {
                          targetEur: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                  <label className="flex items-center gap-2 text-xs sm:col-span-2">
                    <input
                      type="checkbox"
                      checked={pf.requireAiGate}
                      onChange={(e) =>
                        updatePortfolio(pf.id, {
                          requireAiGate: e.target.checked,
                        })
                      }
                    />
                    Gate IA obligatoire avant trade
                  </label>
                  <label className="flex items-center gap-2 text-xs sm:col-span-2">
                    <input
                      type="checkbox"
                      checked={pf.maxSafetyMode}
                      onChange={(e) =>
                        updatePortfolio(pf.id, {
                          maxSafetyMode: e.target.checked,
                        })
                      }
                    />
                    Sureté max (1h+4h / 1d)
                  </label>
                </div>
              </div>
            ))}
          </div>

          <Button
            className="mt-4"
            size="sm"
            disabled={saving}
            onClick={() => void savePrefs()}
          >
            {saving ? "Enregistrement…" : "Enregistrer Lab"}
          </Button>
        </section>
      ) : null}

      <section className="rounded-2xl border border-border/80 bg-card/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-medium">Corrélation DXY / yields vs BTC</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Mesure si BTC bouge avec le dollar (DXY) et le taux US 10 ans.
              Corrélation négative BTC↔DXY = classique risk-off (dollar fort →
              crypto sous pression). Sert à contextualiser les shorts/longs,
              pas à timer un trade seul.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => void refresh()}>
            Rafraîchir
          </Button>
        </div>
        {corr ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <Metric
              label="BTC ↔ DXY"
              value={
                corr.corrBtcDxy === null ? "n/d" : corr.corrBtcDxy.toFixed(2)
              }
            />
            <Metric
              label="BTC ↔ US10Y"
              value={
                corr.corrBtcYield === null
                  ? "n/d"
                  : corr.corrBtcYield.toFixed(2)
              }
            />
            <Metric
              label="Derniers"
              value={`BTC ${corr.latest.btc ? formatPx(corr.latest.btc) : "—"} · DXY ${corr.latest.dxy?.toFixed(2) ?? "—"} · 10Y ${corr.latest.yield10y?.toFixed(2) ?? "—"}%`}
            />
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            Données indisponibles
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-border/80 bg-card/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-medium">Backtest moteur corrélé (90 j)</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Proxy multi-TF (1h+4h+1d) avec filtre sureté max : entrée seulement
              si 1h et 4h alignés. Pas le RSI seul — même logique que le live,
              sans crowd/Nansen historique.
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void runBacktest(30)}>
              30 j
            </Button>
            <Button size="sm" variant="outline" onClick={() => void runBacktest(60)}>
              60 j
            </Button>
            <Button size="sm" onClick={() => void runBacktest(90)}>
              90 j
            </Button>
          </div>
        </div>
        {bt ? (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">moteur {bt.engine ?? "correlated"}</Badge>
              <Badge variant="outline">n={bt.sample}</Badge>
              <Badge variant="outline">
                WR{" "}
                {bt.winRate === null
                  ? "n/d"
                  : `${(bt.winRate * 100).toFixed(0)}%`}
              </Badge>
              <Badge variant="outline">
                E{" "}
                {bt.expectancyPct === null
                  ? "n/d"
                  : `${bt.expectancyPct.toFixed(2)}%`}
              </Badge>
              <Badge variant="outline">
                PF{" "}
                {bt.profitFactor === null ? "n/d" : bt.profitFactor.toFixed(2)}
              </Badge>
            </div>
            <ul className="max-h-48 space-y-1 overflow-auto text-xs">
              {bt.trades
                .slice(-12)
                .reverse()
                .map((t, i) => (
                  <li
                    key={`${t.entryAt}-${i}`}
                    className="flex justify-between gap-2"
                  >
                    <span>
                      {t.side.toUpperCase()} {t.coin} · {t.rule}
                      {"alignmentProxy" in t && t.alignmentProxy != null
                        ? ` · Align~${t.alignmentProxy}`
                        : ""}
                    </span>
                    <span className={signedClass(t.pnlPct)}>
                      {formatPct(t.pnlPct, 2)}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            Lance le backtest corrélé (recommandé : 90 j).
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-border/80 bg-card/60 p-4">
        <h3 className="font-medium">Positions paper (live)</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          <strong className="font-medium text-foreground">pending</strong> =
          limite pas encore touchée. <strong className="font-medium text-foreground">open</strong> =
          position simulée ouverte, PnL € mis à jour au prix live. TP/SL
          ferment automatiquement.
        </p>
        {paper.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Aucun paper pour l’instant — un signal fort en créera un.
          </p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {paper.slice(0, 20).map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-2"
              >
                <div>
                  <Badge
                    variant="outline"
                    className={
                      t.side === "long"
                        ? "border-long/40 text-long"
                        : "border-short/40 text-short"
                    }
                  >
                    {t.side.toUpperCase()} {t.coin}
                  </Badge>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {t.status}
                    {t.entryMode === "limit_wait" ? " · limite" : " · marché"}
                    {t.note ? ` · ${t.note}` : ""}
                  </span>
                </div>
                <div className="numeric text-xs text-right">
                  <div>
                    E {formatPx(t.entry)} · TP {formatPx(t.tp)} · SL{" "}
                    {formatPx(t.sl)}
                  </div>
                  <div>
                    Marge {t.marginEur?.toFixed?.(2) ?? "—"} € ·{" "}
                    {t.pnlEur != null ? (
                      <span className={signedClass(t.pnlEur)}>
                        {t.pnlEur >= 0 ? "+" : ""}
                        {t.pnlEur.toFixed(2)} €
                      </span>
                    ) : (
                      "—"
                    )}
                    {t.pnlPct != null ? (
                      <span className={`ml-1 ${signedClass(t.pnlPct)}`}>
                        ({formatPct(t.pnlPct, 2)})
                      </span>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-border/80 bg-card/60 p-4">
        <h3 className="font-medium">Journal des signaux</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Historique des LONG/SHORT envoyés (Telegram). Utile pour revoir ce qui
          a été proposé, à quelle entrée/TP/SL, et comparer au paper.
        </p>
        {journal.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Vide — les signaux Telegram s’y ajoutent.
          </p>
        ) : (
          <ul className="mt-3 max-h-72 space-y-2 overflow-auto text-sm">
            {journal.map((e) => (
              <li key={e.id} className="border-b border-border/40 pb-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">
                    {e.action.toUpperCase()} {e.coin}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(e.at).toLocaleString("fr-FR")} · conf{" "}
                    {e.confidence}
                  </span>
                </div>
                <p className="mt-1 numeric text-xs">
                  Entrée {e.entry ?? "—"} · TP {e.tp ?? "—"} · SL {e.sl ?? "—"} ·{" "}
                  {e.leverage} · {e.sizePct}
                </p>
                <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                  {e.reason}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/30 px-3 py-2">
      <p className="text-[10px] tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-0.5 break-all text-sm font-medium">{value}</p>
    </div>
  );
}
