"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPct, formatPx, signedClass } from "@/lib/format";
import type { JournalEntry, PaperTrade, UserPrefs } from "@/lib/user-types";
import type { BacktestPayload } from "@/lib/backtest";
import type { CorrelationPayload } from "@/lib/correlation";
import { DEFAULT_PREFS } from "@/lib/user-types";

export function LabPanel() {
  const [prefs, setPrefs] = useState<UserPrefs | null>(null);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [paper, setPaper] = useState<PaperTrade[]>([]);
  const [corr, setCorr] = useState<CorrelationPayload | null>(null);
  const [bt, setBt] = useState<BacktestPayload | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
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
      if (!c.error || c.latest) setCorr(c);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Erreur lab");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
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
          Journal des signaux, paper trade, corrélation macro, backtest RSI,
          préférences (levier, hush hours TG).
        </p>
        {msg ? <p className="mt-2 text-sm text-primary">{msg}</p> : null}
      </section>

      {prefs ? (
        <section className="rounded-2xl border border-border/80 bg-card/60 p-4">
          <h3 className="font-medium">Préférences</h3>
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
          </div>
          <Button className="mt-3" size="sm" onClick={() => void savePrefs()}>
            Enregistrer
          </Button>
        </section>
      ) : null}

      <section className="rounded-2xl border border-border/80 bg-card/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium">Corrélation DXY / yields vs BTC</h3>
          <Button size="sm" variant="outline" onClick={() => void refresh()}>
            Rafraîchir
          </Button>
        </div>
        {corr ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <Metric
              label="BTC ↔ DXY"
              value={
                corr.corrBtcDxy === null
                  ? "n/d"
                  : corr.corrBtcDxy.toFixed(2)
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
          <p className="mt-2 text-sm text-muted-foreground">Données indisponibles</p>
        )}
        {corr?.note ? (
          <p className="mt-2 text-xs text-muted-foreground">{corr.note}</p>
        ) : null}
        {corr?.error ? (
          <p className="mt-1 text-xs text-amber-300">{corr.error}</p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-border/80 bg-card/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium">Backtest RSI (4h)</h3>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void runBacktest(30)}>
              30 j
            </Button>
            <Button size="sm" variant="outline" onClick={() => void runBacktest(60)}>
              60 j
            </Button>
            <Button size="sm" variant="outline" onClick={() => void runBacktest(90)}>
              90 j
            </Button>
          </div>
        </div>
        {bt ? (
          <div className="mt-3 space-y-2">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">n={bt.sample}</Badge>
              <Badge variant="outline">
                WR{" "}
                {bt.winRate === null ? "n/d" : `${(bt.winRate * 100).toFixed(0)}%`}
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
            <p className="text-xs text-muted-foreground">{bt.note}</p>
            <ul className="max-h-48 space-y-1 overflow-auto text-xs">
              {bt.trades.slice(-12).reverse().map((t, i) => (
                <li key={`${t.entryAt}-${i}`} className="flex justify-between gap-2">
                  <span>
                    {t.side.toUpperCase()} {t.coin} · {t.rule}
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
            Lance un backtest 30–90 j.
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-border/80 bg-card/60 p-4">
        <h3 className="font-medium">Paper trades</h3>
        {paper.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Aucun paper pour l’instant.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {paper.slice(0, 15).map((t) => (
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
                    {t.note ? ` · ${t.note}` : ""}
                  </span>
                </div>
                <div className="numeric text-xs">
                  E {formatPx(t.entry)} · TP {formatPx(t.tp)} · SL {formatPx(t.sl)}
                  {t.pnlPct !== null ? (
                    <span className={`ml-2 ${signedClass(t.pnlPct)}`}>
                      {formatPct(t.pnlPct, 2)}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-border/80 bg-card/60 p-4">
        <h3 className="font-medium">Journal des signaux LONG/SHORT</h3>
        {journal.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Vide — les signaux envoyés sur Telegram s’y ajoutent.
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
                    {new Date(e.at).toLocaleString("fr-FR")} · conf {e.confidence}
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
      <p className="mt-0.5 text-sm font-medium break-all">{value}</p>
    </div>
  );
}
