"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPct, formatPx, signedClass } from "@/lib/format";
import type {
  JournalEntry,
  PaperAccount,
  PaperTrade,
  UserPrefs,
} from "@/lib/user-types";
import type { BacktestPayload } from "@/lib/backtest";
import type { CorrelationPayload } from "@/lib/correlation";
import { DEFAULT_PREFS } from "@/lib/user-types";

export function LabPanel() {
  const [prefs, setPrefs] = useState<UserPrefs | null>(null);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [paper, setPaper] = useState<PaperTrade[]>([]);
  const [account, setAccount] = useState<PaperAccount | null>(null);
  const [corr, setCorr] = useState<CorrelationPayload | null>(null);
  const [bt, setBt] = useState<BacktestPayload | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      const [p, j, pa, c] = await Promise.all([
        fetch("/api/prefs").then((r) => r.json()),
        fetch("/api/journal").then((r) => r.json()),
        fetch("/api/paper").then((r) => r.json()),
        fetch("/api/correlation").then((r) => r.json()),
      ]);
      setPrefs(p.prefs ?? DEFAULT_PREFS);
      setJournal(j.entries ?? []);
      setPaper(pa.trades ?? []);
      setAccount(pa.account ?? null);
      if (!c.error || c.latest) setCorr(c);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Erreur lab");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 12_000);
    return () => window.clearInterval(id);
  }, []);

  async function savePrefs() {
    if (!prefs) return;
    const res = await fetch("/api/prefs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(prefs),
    });
    const json = await res.json();
    if (res.ok) {
      setPrefs(json.prefs);
      setMsg("Préférences enregistrées");
    } else {
      setMsg(json.error || "Échec sauvegarde");
    }
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
          <h3 className="font-medium">Préférences</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Levier max plafonne les suggestions. Cryptos suivies = watchlist
            signaux. Hush hours = pas de Telegram la nuit (UTC). Paper auto =
            chaque signal fort ouvre une simu.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <Label htmlFor="lev">Levier max</Label>
              <Input
                id="lev"
                type="number"
                min={1}
                max={10}
                value={prefs.maxLeverage}
                onChange={(e) =>
                  setPrefs({ ...prefs, maxLeverage: Number(e.target.value) })
                }
              />
            </div>
            <div>
              <Label htmlFor="bank">Solde paper (€)</Label>
              <Input
                id="bank"
                type="number"
                min={100}
                max={100000}
                value={prefs.paperBankrollEur ?? 1000}
                onChange={(e) =>
                  setPrefs({
                    ...prefs,
                    paperBankrollEur: Number(e.target.value),
                  })
                }
              />
            </div>
            <div>
              <Label htmlFor="hushS">Hush hours début (UTC)</Label>
              <Input
                id="hushS"
                type="number"
                min={0}
                max={23}
                value={prefs.hushHoursStart}
                onChange={(e) =>
                  setPrefs({
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
                  setPrefs({ ...prefs, hushHoursEnd: Number(e.target.value) })
                }
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="coins">Cryptos suivies (virgules)</Label>
              <Input
                id="coins"
                value={prefs.watchCoins.join(", ")}
                onChange={(e) =>
                  setPrefs({
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
                  setPrefs({ ...prefs, telegramEnabled: e.target.checked })
                }
              />
              Telegram activé
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={prefs.paperTradeEnabled}
                onChange={(e) =>
                  setPrefs({ ...prefs, paperTradeEnabled: e.target.checked })
                }
              />
              Paper trade auto
            </label>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={prefs.maxSafetyMode !== false}
                onChange={(e) =>
                  setPrefs({ ...prefs, maxSafetyMode: e.target.checked })
                }
              />
              Sureté max — TG seulement si 1h+4h alignés et crowd WR ≥58 %
            </label>
          </div>
          <Button className="mt-3" size="sm" onClick={() => void savePrefs()}>
            Enregistrer
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
