"use client";

import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { PriceChart } from "@/components/price-chart";
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
  computePaperAccount,
  ensurePortfolios,
  isScalpPortfolio,
  makeCustomPortfolio,
  portfolioAllowsLive,
} from "@/lib/user-types";
import { syncPaperFromBrowser, writeLocalPaper } from "@/lib/paper-local";
import { readResponseJson } from "@/lib/safe-json";

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
    howto: { where: string; upstash: string; live?: string; siteGate?: string };
  } | null>(null);
  const [tg, setTg] = useState<{
    linked: boolean;
    chatIdPreview: string | null;
    bot: string;
    instruction: string;
  } | null>(null);
  const [tgBusy, setTgBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveStatus, setLiveStatus] = useState<{
    env: {
      armed: boolean;
      hasAgentKey: boolean;
      ready: boolean;
      reason: string | null;
      testnet: boolean;
      maxNotionalUsd: number;
      maxLeverage: number;
      maxOpenPositions: number;
      agentAddress: string | null;
      accountAddress: string | null;
    };
    prefs: { liveTradeEnabled: boolean; boriazLiveTradeEnabled: boolean };
  } | null>(null);
  const [livePortfolio, setLivePortfolio] = useState<{
    ok: boolean;
    reason?: string;
    testnet: boolean;
    address: string | null;
    accountValueUsd: number;
    totalMarginUsedUsd: number;
    withdrawableUsd: number;
    totalUnrealizedPnlUsd: number;
    openPositionCount: number;
    perpEquityUsd?: number;
    spotUsdcUsd?: number;
    positions: {
      coin: string;
      side: "long" | "short";
      size: number;
      entryPx: number;
      positionValueUsd: number;
      unrealizedPnlUsd: number;
      leverage: number;
      marginUsedUsd: number;
      botLabel?: string | null;
      portfolioName?: string | null;
      tp?: number | null;
      sl?: number | null;
      tpPnlUsd?: number | null;
      slPnlUsd?: number | null;
      riskUsd?: number | null;
    }[];
  } | null>(null);
  const [smcBusy, setSmcBusy] = useState(false);
  const [signalBusy, setSignalBusy] = useState(false);
  const [smc, setSmc] = useState<{
    best: {
      coin: string;
      status: string;
      confidence: number;
      report: string;
      checklist: Record<string, boolean>;
      side: string | null;
    } | null;
    aiApproved: boolean;
    aiNote: string | null;
    aiReport: string | null;
    model: string;
    setups?: { coin: string; status: string; confidence: number }[];
  } | null>(null);
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
        fetch("/api/prefs").then((r) =>
          readResponseJson<{ prefs?: UserPrefs }>(r),
        ),
        fetch("/api/journal").then((r) =>
          readResponseJson<{ entries?: JournalEntry[] }>(r),
        ),
        fetch("/api/paper").then((r) =>
          readResponseJson<{ trades?: PaperTrade[]; account?: PaperAccount }>(r),
        ),
        fetch("/api/correlation").then((r) =>
          readResponseJson<CorrelationPayload & { error?: string }>(r),
        ),
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
      const st = await fetch("/api/status").then((r) => readResponseJson<NonNullable<typeof status>>(r));
      setStatus(st);
      try {
        const tgStatus = await fetch("/api/telegram/setup").then((r) => readResponseJson<NonNullable<typeof tg>>(r));
        setTg(tgStatus);
      } catch {
        /* ignore */
      }
      try {
        const live = await fetch("/api/live-status").then((r) => readResponseJson<NonNullable<typeof liveStatus>>(r));
        if (live?.env) setLiveStatus(live);
      } catch {
        /* ignore */
      }
      try {
        const liveAcc = await fetch("/api/live-account").then((r) =>
          readResponseJson<{
            env?: NonNullable<typeof liveStatus>["env"];
            prefs?: NonNullable<typeof liveStatus>["prefs"];
            portfolio?: NonNullable<typeof livePortfolio>;
          }>(r),
        );
        if (liveAcc?.portfolio) setLivePortfolio(liveAcc.portfolio);
        if (liveAcc?.env) {
          setLiveStatus({
            env: liveAcc.env,
            prefs: liveAcc.prefs ?? {
              liveTradeEnabled: false,
              boriazLiveTradeEnabled: false,
            },
          });
        }
      } catch {
        /* ignore */
      }
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
          watchCoins: [
            ...new Set([
              ...(local.watchCoins ?? []),
              ...DEFAULT_PREFS.watchCoins,
            ]),
          ],
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

  async function savePrefs(nextPrefs?: UserPrefs) {
    const base = nextPrefs ?? prefs;
    if (!base) return;
    setSaving(true);
    setMsg("Enregistrement…");
    const payload = {
      ...base,
      portfolios: ensurePortfolios(base.portfolios),
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
    // LIVE : Défaut + Boriaz + Scalp. Risqué / autres forcé paper-only.
    const target = ensurePortfolios(prefs.portfolios).find((p) => p.id === id);
    const allowsLive = target ? portfolioAllowsLive(target) : false;
    const finalPatch =
      "liveTradeEnabled" in patch && patch.liveTradeEnabled && !allowsLive
        ? { ...patch, liveTradeEnabled: false }
        : allowsLive
          ? patch
          : { ...patch, liveTradeEnabled: false };
    const portfolios = ensurePortfolios(prefs.portfolios).map((p) =>
      p.id === id
        ? { ...p, ...finalPatch, id: p.id, isDefault: p.isDefault }
        : p,
    );
    const next = { ...prefs, portfolios };
    patchPrefs(next);
    // Auto-save immédiat pour les toggles LIVE / paper (sinon le cron ignore)
    if (
      "liveTradeEnabled" in patch ||
      "paperTradeEnabled" in patch ||
      "enabled" in patch
    ) {
      void savePrefs(next);
    }
  }

  function addPortfolio(kind: "scalp" | "risky" | "swing") {
    if (!prefs) return;
    const preset =
      kind === "scalp"
        ? makeCustomPortfolio({
            name: "Scalp 1h",
            timeframe: "1h",
            riskLevel: 3,
            maxLeverage: 2,
            minRR: 1.2,
            tradesPerDay: 8,
            sizePct: 1,
            riskPct: 0.25,
            maxLossEur: 30,
            targetEur: 40,
            maxSafetyMode: false,
            liveTradeEnabled: false,
          })
        : kind === "risky"
          ? makeCustomPortfolio({
              name: "Risqué (rentable)",
              timeframe: "1h",
              riskLevel: 4,
              maxLeverage: 5,
              minRR: 1.8,
              tradesPerDay: 5,
              sizePct: 8,
              maxLossEur: 120,
              targetEur: 250,
              maxSafetyMode: false,
              requireAiGate: true,
              liveTradeEnabled: false,
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
              liveTradeEnabled: false,
            });
    patchPrefs({
      ...prefs,
      portfolios: ensurePortfolios([...prefs.portfolios, preset]),
    });
  }

  function removePortfolio(id: string) {
    if (!prefs || id === "default" || id === "boriaz") return;
    patchPrefs({
      ...prefs,
      portfolios: ensurePortfolios(
        prefs.portfolios.filter((p) => p.id !== id),
      ),
    });
  }

  
  /** Même cerveau : force un scan immédiat paper + live (sans attendre le cron). */
  async function runSignalsNow() {
    setSignalBusy(true);
    setMsg("Scan immédiat paper + live (même cerveau)…");
    try {
      const res = await fetch("/api/signals?force=1&notify=1", {
        cache: "no-store",
      });
      const json = await readResponseJson<{ error?: string }>(res);
      if (!res.ok) {
        setMsg(json.error || "Scan signaux échoué");
        return;
      }
      setMsg(
        "Scan terminé — s’il y a un setup, paper et live partent ensemble (toggles LIVE ON).",
      );
      await refresh({ forcePrefs: true });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Scan signaux échoué");
    } finally {
      setSignalBusy(false);
    }
  }

  async function runSmcScan(force = false) {
    setSmcBusy(true);
    setMsg("Scan SMC Boriaz (Claude Haiku)…");
    try {
      const res = await fetch(`/api/smc${force ? "?force=1" : ""}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) {
        setMsg(json.error || "Scan SMC échoué");
        return;
      }
      setSmc(json);
      const best = json.best;
      setMsg(
        best
          ? `SMC ${best.coin} · ${best.status} · conf ${best.confidence}${json.aiApproved ? " · Claude ✓" : " · Claude ✗"}`
          : "Aucun setup SMC sur la watchlist",
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Scan SMC impossible");
    } finally {
      setSmcBusy(false);
    }
  }

  async function callTelegram(action: "link" | "test" | "digest") {
    setTgBusy(action);
    setMsg(
      action === "link"
        ? "Liaison Telegram…"
        : action === "test"
          ? "Envoi du test forcé…"
          : "Envoi du bilan forcé…",
    );
    try {
      const res = await fetch("/api/telegram/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (action === "link") {
        setMsg(
          json.chatId
            ? `Telegram lié ✓ (${json.username ?? "chat"}). ${json.detail ?? ""}`
            : `Pas encore lié : ${json.detail ?? "envoie /start à @BoriazBot"}`,
        );
      } else if (action === "test") {
        setMsg(
          json.ok
            ? "Message test envoyé ✓ (vérifie Telegram)"
            : `Échec envoi : ${json.error ?? "inconnu"}`,
        );
      } else {
        setMsg(
          json.ok
            ? `Bilan forcé envoyé ✓ (${json.quotes ?? 0} cryptos, ${json.spikesSent ?? 0} spikes)`
            : `Bilan non envoyé : ${json.errors?.join?.(" · ") ?? "voir clés Telegram"}`,
        );
      }
      try {
        const tgStatus = await fetch("/api/telegram/setup").then((r) => readResponseJson<NonNullable<typeof tg>>(r));
        setTg(tgStatus);
      } catch {
        /* ignore */
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Erreur Telegram");
    } finally {
      setTgBusy(null);
    }
  }

  async function runManage() {
    setTgBusy("manage");
    setMsg("Relecture IA des trades ouverts…");
    try {
      const res = await fetch("/api/manage", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setMsg(json.error || "Gestion échouée");
      } else {
        const acts = (json.decisions ?? [])
          .map(
            (d: { coin: string; side: string; action: string }) =>
              `${d.coin} ${d.side}→${d.action}`,
          )
          .join(", ");
        setMsg(
          `Relecture ${json.reviewed ?? 0} trade(s)${json.aiUsed ? " (IA)" : " (règles)"}${acts ? " · " + acts : " · rien à faire"}`,
        );
        if (json.trades) {
          setPaper(json.trades);
          writeLocalPaper(json.trades);
        }
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Gestion impossible");
    } finally {
      setTgBusy(null);
    }
  }

  async function closeLabTrade(id: string) {
    setMsg("Clôture…");
    try {
      const res = await fetch("/api/paper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close", id }),
      });
      const json = await res.json();
      if (res.ok) {
        if (json.trades) {
          setPaper(json.trades);
          writeLocalPaper(json.trades);
        }
        setMsg("Trade clôturé ✓");
      } else {
        setMsg(json.error || "Clôture échouée");
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Clôture impossible");
    }
  }

  async function mirrorPaperToLive(id: string) {
    setMsg("Copie paper → LIVE au marché…");
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
      if (!res.ok || !json.ok) {
        setMsg(json.error || "Copie LIVE échouée");
        return;
      }
      if (json.trade) {
        setPaper((prev) =>
          prev.map((t) => (t.id === id ? { ...t, ...json.trade! } : t)),
        );
      }
      setMsg(
        `LIVE HL ✓ @ mid ${json.mid} · size ${json.live?.size ?? "?"} · oid ${json.live?.entryOid ?? "—"}`,
      );
      await refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Copie LIVE impossible");
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
        <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
          {(
            [
              ["prefs", "Préférences"],
              ["portfolios", "Portefeuilles"],
              ["smc", "SMC"],
              ["backtest", "Backtest"],
              ["paper", "Paper"],
              ["journal", "Journal"],
            ] as const
          ).map(([id, label]) => (
            <a
              key={id}
              href={`#lab-${id}`}
              className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-muted-foreground hover:border-primary/30 hover:text-primary"
            >
              {label}
            </a>
          ))}
        </div>
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
          <p className="mt-2 text-xs text-muted-foreground">
            {status.howto.siteGate ??
              "SITE_PASSWORD protège l’UI ; le cron/bot continue en fond."}
          </p>
          <button
            type="button"
            className="mt-2 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            onClick={() => {
              void fetch("/api/site-auth", { method: "DELETE" }).then(() => {
                window.location.href = "/#home";
              });
            }}
          >
            Verrouiller l’accès (logout portail)
          </button>
        </section>
      ) : null}

      <section className="rounded-2xl border border-primary/25 bg-primary/5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium">Telegram — mise en place & envoi forcé</h3>
          <Badge variant="outline" className={tg?.linked ? "text-long" : "text-short"}>
            {tg?.linked ? `lié · ${tg.chatIdPreview ?? ""}` : "non lié"}
          </Badge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          1) Ouvre Telegram → cherche{" "}
          <strong className="text-foreground">{tg?.bot ?? "@BoriazBot"}</strong>{" "}
          → envoie <strong className="text-foreground">/start</strong>. 2) Clique{" "}
          <strong className="text-foreground">Lier Telegram</strong> ci-dessous.
          Le token du bot (<code>TELEGRAM_BOT_TOKEN</code>) doit être dans les
          variables Vercel.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={tgBusy !== null}
            onClick={() => void callTelegram("link")}
          >
            {tgBusy === "link" ? "Liaison…" : "Lier Telegram"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={tgBusy !== null}
            onClick={() => void callTelegram("test")}
          >
            {tgBusy === "test" ? "Envoi…" : "Envoyer un test (forcé)"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={tgBusy !== null}
            onClick={() => void callTelegram("digest")}
          >
            {tgBusy === "digest" ? "Envoi…" : "Forcer le bilan (digest)"}
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          « Envoyer un test » force un message immédiat pour vérifier la liaison.
          « Forcer le bilan » recalcule et pousse le digest prix tout de suite,
          sans attendre le cron.
        </p>
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
          <h3 id="lab-prefs" className="font-medium">Préférences globales</h3>
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
            <label className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
              <input
                type="checkbox"
                checked={Boolean(prefs.liveTradeEnabled)}
                onChange={(e) => {
                  const next = {
                    ...prefs,
                    liveTradeEnabled: e.target.checked,
                  };
                  patchPrefs(next);
                  void savePrefs(next);
                }}
              />
              LIVE master (Défaut / Scalp toggles) — Boriaz paper → live miroir
            </label>
            <p className="text-[11px] text-muted-foreground sm:col-span-2">
              LIVE réel : <strong>Défaut</strong>, <strong>Boriaz</strong>,{" "}
              <strong>Scalp</strong> (petites mises ~0,25 % equity).{" "}
              <strong>Risqué</strong> = paper only, jamais HL. Scalp se
              désactive via sa case LIVE HL ci-dessous. Kill-switch env{" "}
              <code className="text-[10px]">HL_LIVE_ENABLED</code> obligatoire.
            </p>
          </div>
          {liveStatus ? (
            <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-relaxed">
              <p className="font-medium text-amber-800 dark:text-amber-300">
                Statut LIVE Hyperliquid
              </p>
              <p className="mt-1 text-muted-foreground">
                Env armé : {liveStatus.env.armed ? "oui" : "non"} · Clé agent :{" "}
                {liveStatus.env.hasAgentKey ? "présente" : "absente"} · Prêt :{" "}
                {liveStatus.env.ready ? "oui" : "non"}
                {liveStatus.env.reason ? ` (${liveStatus.env.reason})` : ""} ·
                Testnet : {liveStatus.env.testnet ? "oui" : "non"} · Cap{" "}
                {liveStatus.env.maxNotionalUsd}$ / lev{" "}
                {liveStatus.env.maxLeverage}× / max{" "}
                {liveStatus.env.maxOpenPositions} pos.
              </p>
              <div className="mt-2 space-y-1 font-mono text-[11px] text-muted-foreground">
                {liveStatus.env.agentAddress ? (
                  <p>
                    Agent (signe) {liveStatus.env.agentAddress.slice(0, 6)}…
                    {liveStatus.env.agentAddress.slice(-4)}
                  </p>
                ) : null}
                {liveStatus.env.accountAddress ? (
                  <p>
                    Master (solde) {liveStatus.env.accountAddress.slice(0, 6)}…
                    {liveStatus.env.accountAddress.slice(-4)}
                  </p>
                ) : (
                  <p className="text-amber-700 dark:text-amber-400">
                    HL_ACCOUNT_ADDRESS manquante — mets ton adresse MASTER
                    (celle à ~109$), pas l’agent API.
                  </p>
                )}
              </div>
              <p className="mt-2 text-muted-foreground">
                Paper et live = <strong className="text-foreground">même cerveau</strong>,
                même passage : dès qu’un setup est pris en paper, le live part
                juste après (pas 1 min plus tard). Le cron ne fait que
                <em> rescanner</em> ; avec LIVE armé le scan auto passe à ~1 min
                (Lab ouvert / accueil).
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="default"
                  disabled={signalBusy}
                  onClick={() => void runSignalsNow()}
                >
                  {signalBusy
                    ? "Scan…"
                    : "Exécuter paper + live maintenant"}
                </Button>
              </div>
              <p className="mt-2 text-muted-foreground">
                Vercel Env :{" "}
                <code className="text-[11px]">HL_AGENT_PRIVATE_KEY</code> (clé
                agent) +{" "}
                <code className="text-[11px]">HL_ACCOUNT_ADDRESS</code> = adresse{" "}
                <strong className="text-foreground">MASTER</strong> (celle avec
                tes ~109$) +{" "}
                <code className="text-[11px]">HL_LIVE_ENABLED=true</code> +
                toggles Lab.
              </p>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4">
        <h3 id="lab-live-portfolio" className="font-medium">
          Portefeuille réel Hyperliquid
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Compte HL réel — séparé du paper. Le live Boriaz risque{" "}
          <strong className="text-foreground">2% de ce solde</strong>, pas du
          capital paper. Les P&L paper plus bas ne sont jamais mélangés ici.
        </p>
        {livePortfolio ? (
          livePortfolio.ok ? (
            <>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Metric
                  label="Account value"
                  value={`${livePortfolio.accountValueUsd.toFixed(2)} $`}
                />
                <Metric
                  label="Marge utilisée"
                  value={`${livePortfolio.totalMarginUsedUsd.toFixed(2)} $`}
                />
                <Metric
                  label="Withdrawable"
                  value={`${livePortfolio.withdrawableUsd.toFixed(2)} $`}
                />
                <Metric
                  label="PnL latent"
                  value={`${livePortfolio.totalUnrealizedPnlUsd >= 0 ? "+" : ""}${livePortfolio.totalUnrealizedPnlUsd.toFixed(2)} $`}
                  className={signedClass(livePortfolio.totalUnrealizedPnlUsd)}
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {livePortfolio.testnet ? "Testnet" : "Mainnet"} ·{" "}
                {livePortfolio.openPositionCount} position
                {livePortfolio.openPositionCount > 1 ? "s" : ""}
                {livePortfolio.address
                  ? ` · ${livePortfolio.address.slice(0, 6)}…${livePortfolio.address.slice(-4)}`
                  : ""}
                {" · "}perp {(livePortfolio.perpEquityUsd ?? 0).toFixed(2)}$ · spot
                USDC {(livePortfolio.spotUsdcUsd ?? 0).toFixed(2)}$ · risque live
                2% ≈{" "}
                <span className="text-foreground">
                  {(livePortfolio.accountValueUsd * 0.02).toFixed(2)} $
                </span>{" "}
                par trade
              </p>
              {livePortfolio.reason ? (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  {livePortfolio.reason}
                </p>
              ) : null}
              {livePortfolio.positions.length ? (
                <ul className="mt-3 space-y-2">
                  {livePortfolio.positions.map((p) => (
                    <li
                      key={`${p.coin}-${p.side}`}
                      className="rounded-lg border border-border/60 bg-card/60 px-3 py-2 text-sm"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">
                          {p.coin}{" "}
                          <span className="text-xs uppercase text-muted-foreground">
                            {p.side} {p.leverage}×
                          </span>
                          {p.botLabel ? (
                            <span className="ml-2 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                              {p.botLabel}
                            </span>
                          ) : (
                            <span className="ml-2 text-[10px] text-muted-foreground">
                              bot ?
                            </span>
                          )}
                        </span>
                        <span className={signedClass(p.unrealizedPnlUsd)}>
                          {p.unrealizedPnlUsd >= 0 ? "+" : ""}
                          {p.unrealizedPnlUsd.toFixed(2)} $
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        size {p.size} · entry {p.entryPx}
                        {p.tp != null ? ` · TP ${p.tp}` : ""}
                        {p.sl != null ? ` · SL ${p.sl}` : ""}
                        {" · "}notionnel {p.positionValueUsd.toFixed(2)} $ · marge{" "}
                        {p.marginUsedUsd.toFixed(2)} $
                      </p>
                      <p className="mt-0.5 text-xs">
                        <span className="text-emerald-700 dark:text-emerald-400">
                          Si TP{" "}
                          {p.tpPnlUsd != null
                            ? `${p.tpPnlUsd >= 0 ? "+" : ""}${p.tpPnlUsd.toFixed(2)} $`
                            : "—"}
                        </span>
                        {" · "}
                        <span className="text-rose-700 dark:text-rose-400">
                          Si SL{" "}
                          {p.slPnlUsd != null
                            ? `${p.slPnlUsd >= 0 ? "+" : ""}${p.slPnlUsd.toFixed(2)} $`
                            : "—"}
                        </span>
                        {p.riskUsd != null ? (
                          <span className="text-muted-foreground">
                            {" "}
                            · risque ~{p.riskUsd.toFixed(2)} $
                          </span>
                        ) : null}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  Aucune position ouverte sur HL pour le moment.
                  {livePortfolio.accountValueUsd <= 0 && livePortfolio.reason
                    ? ` — ${livePortfolio.reason}`
                    : ""}
                </p>
              )}
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              {livePortfolio.reason ||
                "Compte HL illisible — HL_ACCOUNT_ADDRESS doit être le MASTER (pas l’agent)."}
            </p>
          )
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            Chargement du compte HL… (nécessite la clé agent en env Vercel)
          </p>
        )}
      </section>

      {prefs ? (
        <section className="rounded-2xl border border-primary/25 bg-primary/5 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 id="lab-portfolios" className="font-medium">Portefeuilles paper (simulation)</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Capital paper = <strong className="text-foreground">simulation seulement</strong>.
                Il ne size <em>pas</em> les ordres LIVE. Le live Boriaz utilise
                2% du solde HL réel (section au-dessus).{" "}
                <strong className="text-foreground">Défaut</strong> (Alignement)
                et <strong className="text-foreground">Boriaz</strong> (SMC)
                toujours présents.
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
                      disabled={pf.isDefault || pf.id === "boriaz"}
                      onChange={(e) =>
                        updatePortfolio(pf.id, { name: e.target.value })
                      }
                    />
                    {pf.isDefault ? (
                      <Badge variant="outline">Obligatoire</Badge>
                    ) : null}
                    {pf.id === "boriaz" || pf.strategy === "smc" ? (
                      <Badge className="border-primary/40 bg-primary/15 text-primary">
                        SMC · risque {pf.riskPct ?? 2}%
                      </Badge>
                    ) : null}
                    <label className="flex items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={pf.enabled}
                        disabled={pf.isDefault || pf.id === "boriaz"}
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
                    {portfolioAllowsLive(pf) ? (
                      <label className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                        <input
                          type="checkbox"
                          checked={Boolean(pf.liveTradeEnabled)}
                          onChange={(e) =>
                            updatePortfolio(pf.id, {
                              liveTradeEnabled: e.target.checked,
                            })
                          }
                        />
                        LIVE HL
                        {pf.id === "default" ? (
                          <span className="text-[10px] text-muted-foreground">
                            (Défaut)
                          </span>
                        ) : pf.id === "boriaz" ? (
                          <span className="text-[10px] text-muted-foreground">
                            (Boriaz)
                          </span>
                        ) : isScalpPortfolio(pf) ? (
                          <span className="text-[10px] text-muted-foreground">
                            (Scalp · petites mises)
                          </span>
                        ) : null}
                      </label>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">
                        LIVE HL : non (paper only
                        {/risqu/i.test(pf.name) ? " — Risqué bloqué" : ""})
                      </span>
                    )}
                  </div>
                  {!pf.isDefault && pf.id !== "boriaz" ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => removePortfolio(pf.id)}
                    >
                      Supprimer
                    </Button>
                  ) : null}
                </div>
                {pf.strategy === "smc" ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Bot SMC : D1→H4→H1→M15 · paper size sur capital simu · LIVE =
                    2% du solde HL réel · TP1 1R (50 %+BE) · TP2 2R · gate
                    ChatGPT (Claude off).
                  </p>
                ) : null}
                {(() => {
                  const acc = computePaperAccount(paper, pf.bankrollEur, pf.id);
                  const total =
                    acc.realizedPnlEur + acc.unrealizedPnlEur;
                  const fmt = (n: number) =>
                    `${n >= 0 ? "+" : ""}${n.toFixed(2)} €`;
                  return (
                    <div className="mt-3 grid gap-2 rounded-lg border border-border/60 bg-muted/20 p-2 sm:grid-cols-4">
                      <Metric
                        label="Sorti (réalisé)"
                        value={fmt(acc.realizedPnlEur)}
                        className={signedClass(acc.realizedPnlEur)}
                      />
                      <Metric
                        label="En cours (latent)"
                        value={fmt(acc.unrealizedPnlEur)}
                        className={signedClass(acc.unrealizedPnlEur)}
                      />
                      <Metric
                        label="Total P&L"
                        value={fmt(total)}
                        className={signedClass(total)}
                      />
                      <Metric
                        label="Equity"
                        value={`${acc.equityEur.toFixed(2)} €`}
                        className={signedClass(
                          acc.equityEur - acc.bankrollStartEur,
                        )}
                      />
                      <p className="sm:col-span-4 text-[11px] text-muted-foreground">
                        Ouverts {acc.openCount} · en attente {acc.pendingCount} ·
                        clos {acc.closedCount} (W{acc.winCount}/L{acc.lossCount})
                        · départ {acc.bankrollStartEur} €
                      </p>
                    </div>
                  );
                })()}
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <Label>Capital paper (€) — simu</Label>
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
                    <Label>Trades / jour (0 = illimité)</Label>
                    <Input
                      type="number"
                      min={0}
                      max={20}
                      value={pf.tradesPerDay}
                      onChange={(e) =>
                        updatePortfolio(pf.id, {
                          tradesPerDay: Math.min(
                            20,
                            Math.max(0, Math.floor(Number(e.target.value) || 0)),
                          ),
                        })
                      }
                    />
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Défaut 5 — le bot s’arrête après N ouvertures / 24 h.
                    </p>
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

      <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-medium">Boriaz · Smart Money Concepts</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Analyse top-down D1→H4→H1→M15. Entrée si structure SMC (sweep /
              BOS + ÔTE, FVG recommandé). Risque exact 2 %. TP1 1R (50 %+
              break-even) puis TP2 2R. Gate IA :{" "}
              <code className="text-xs">ChatGPT</code> (Claude commenté / off).
            </p>
          </div>
          <Button
            size="sm"
            disabled={smcBusy}
            onClick={() => void runSmcScan(true)}
          >
            {smcBusy ? "Scan…" : "Scanner SMC"}
          </Button>
        </div>
        {smc ? (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline">modèle {smc.model}</Badge>
              <Badge variant="outline">
                Gate IA {smc.aiApproved ? "✓" : "✗"}
              </Badge>
              {smc.best ? (
                <>
                  <Badge variant="outline">
                    {smc.best.coin} · {smc.best.side?.toUpperCase() ?? "—"}
                  </Badge>
                  <Badge variant="outline">conf {smc.best.confidence}</Badge>
                  <Badge
                    variant="outline"
                    className={
                      smc.best.status.includes("PRÊT")
                        ? "border-long/40 text-long"
                        : smc.best.status.includes("ATTENTE")
                          ? "border-primary/40 text-primary"
                          : "border-short/40 text-short"
                    }
                  >
                    {smc.best.status}
                  </Badge>
                </>
              ) : null}
            </div>
            {smc.aiNote ? (
              <p className="text-xs text-muted-foreground">{smc.aiNote}</p>
            ) : null}
            {smc.setups && smc.setups.length > 0 ? (
              <ul className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                {smc.setups.slice(0, 8).map((s) => (
                  <li
                    key={s.coin}
                    className="rounded-md border border-border/60 px-2 py-1"
                  >
                    {s.coin} · {s.confidence} · {s.status.slice(0, 18)}
                  </li>
                ))}
              </ul>
            ) : null}
            <pre className="max-h-80 overflow-auto rounded-xl border border-border/60 bg-background/80 p-3 text-[11px] leading-relaxed whitespace-pre-wrap">
              {smc.aiReport || smc.best?.report || "Lance un scan pour voir le rapport SMC."}
            </pre>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            Clique « Scanner SMC » pour analyser la watchlist avec le bot
            Boriaz (ChatGPT — Claude off).
          </p>
        )}
      </section>

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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium">Positions paper (live)</h3>
          <Button
            size="sm"
            variant="outline"
            disabled={tgBusy !== null}
            onClick={() => void runManage()}
          >
            {tgBusy === "manage" ? "Relecture…" : "Forcer la relecture IA"}
          </Button>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          <strong className="font-medium text-foreground">pending</strong> =
          limite pas encore touchée. <strong className="font-medium text-foreground">open</strong> =
          position simulée ouverte, PnL € (net de frais) mis à jour au prix live.
          TP/SL ferment automatiquement. « Relecture IA » = les 2 IA décident
          fermer / basculer / attendre / laisser (auto ~toutes les 1 min).
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
                className="space-y-2 border-b border-border/40 pb-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
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
                    E {formatPx(t.entry)} · TP {formatPx(t.tp)}
                    {t.tp1 ? ` · TP1 ${formatPx(t.tp1)}` : ""} · SL{" "}
                    {formatPx(t.sl)}
                    {t.tp1Hit ? " · BE" : ""}
                    {t.strategy === "smc" ? " · SMC" : ""}
                  </div>
                  <div>
                    Marge {t.marginEur?.toFixed?.(2) ?? "—"} € · frais{" "}
                    {(t.feesEur ?? 0).toFixed(2)} € ·{" "}
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
                  <div className="text-[11px]">
                    <span className="text-emerald-700 dark:text-emerald-400">
                      Si TP +
                      {(
                        (t.marginEur *
                          (Math.abs(t.tp - t.entry) / t.entry) *
                          t.leverage)
                      ).toFixed(2)}{" "}
                      €
                    </span>
                    {" · "}
                    <span className="text-rose-700 dark:text-rose-400">
                      Si SL −
                      {(
                        (t.marginEur *
                          (Math.abs(t.entry - t.sl) / t.entry) *
                          t.leverage)
                      ).toFixed(2)}{" "}
                      €
                    </span>
                  </div>
                  {t.status === "open" || t.status === "pending" ? (
                    <div className="mt-1 flex flex-wrap justify-end gap-1.5">
                      {(t.portfolioId === "boriaz" || t.strategy === "smc") &&
                      !/LIVE HL/i.test(t.note || "") ? (
                        <button
                          type="button"
                          onClick={() => void mirrorPaperToLive(t.id)}
                          className="rounded-md border border-amber-500/50 px-2 py-0.5 text-[11px] text-amber-700 transition-colors hover:bg-amber-500/10 dark:text-amber-400"
                        >
                          Copier → LIVE (marché)
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void closeLabTrade(t.id)}
                        className="rounded-md border border-short/40 px-2 py-0.5 text-[11px] text-short transition-colors hover:bg-short/10"
                      >
                        Fermer
                      </button>
                    </div>
                  ) : null}
                </div>
                </div>
                <div className="w-full">
                  <PriceChart
                    coin={t.coin}
                    interval="15m"
                    allowToggle
                    height={180}
                    side={t.side}
                    entryAt={t.filledAt ?? t.openedAt}
                    entryPx={t.entry}
                    exitAt={t.closedAt}
                    exitPx={t.exitPx}
                    tp={t.tp}
                    sl={t.sl}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-border/80 bg-card/60 p-4">
        <h3 id="lab-journal" className="font-medium">Journal des signaux</h3>
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

function Metric({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="rounded-lg bg-muted/30 px-3 py-2">
      <p className="text-[10px] tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p
        className={`mt-0.5 break-all text-sm font-medium ${className ?? ""}`}
      >
        {value}
      </p>
    </div>
  );
}
