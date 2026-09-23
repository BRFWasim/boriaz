/**
 * Briefs légers pour l’accueil : santé paper/LIVE + ce que le bot prévoit / attend.
 * Pas de scan SMC lourd — uniquement KV / paper / journal / zones.
 */
import { loadCronStatus } from "./cron-status";
import { kvHealth, kvProbe } from "./kv";
import { loadArmedZones } from "./zone-watch";
import {
  loadPaperTrades,
  loadPrefs,
  persistUserId,
  readJournal,
  setPersistUser,
  storageInfo,
} from "./persist";
import type { UserPrefs } from "./user-types";
import { getLiveConfig, isLiveEnvReady } from "./hl-live";
import { loadLiveJournal } from "./live-journal";

export type BotBriefTone = "info" | "ok" | "warn" | "bad";
export type BotBriefKind =
  | "health"
  | "wait"
  | "plan"
  | "open"
  | "live"
  | "cron";

export type BotBriefItem = {
  id: string;
  kind: BotBriefKind;
  tone: BotBriefTone;
  title: string;
  detail: string;
  at: number;
};

export type BotBriefPayload = {
  items: BotBriefItem[];
  health: {
    paperOk: boolean;
    liveOk: boolean;
    storageOk: boolean;
    cronOk: boolean;
    cronAgeSec: number | null;
    paperOpen: number;
    paperPending: number;
    livePositions: number;
    liveReady: boolean;
    liveArmed: boolean;
    storageBackend: string;
    /** Détail toggles — pour debug UI */
    liveToggles?: {
      global: boolean;
      boriaz: boolean;
      botScope: boolean;
    };
  };
  fetchedAt: number;
};

function agoLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.round(m / 60)} h`;
}

function liveTogglesFromPrefs(prefs: UserPrefs | null | undefined): {
  global: boolean;
  boriaz: boolean;
  on: boolean;
} {
  const global = Boolean(prefs?.liveTradeEnabled);
  const boriaz = Boolean(
    prefs?.portfolios?.find((p) => p.id === "boriaz")?.liveTradeEnabled,
  );
  return { global, boriaz, on: global && boriaz };
}

/** Prefs du bot cron (= user `default`) — c’est ce qui arme vraiment le LIVE. */
async function loadBotPrefs(): Promise<UserPrefs | null> {
  const prev = persistUserId();
  try {
    setPersistUser("default");
    return await loadPrefs();
  } catch {
    return null;
  } finally {
    setPersistUser(prev);
  }
}

export async function getBotBrief(): Promise<BotBriefPayload> {
  const now = Date.now();
  const items: BotBriefItem[] = [];

  const [cron, probe, paper, prefs, journal, zones, liveJournal, botPrefs] =
    await Promise.all([
      loadCronStatus().catch(() => null),
      kvProbe().catch(() => ({ ok: false, error: "probe" })),
      loadPaperTrades().catch(() => []),
      loadPrefs().catch(() => null),
      readJournal(12).catch(() => []),
      loadArmedZones().catch(() => []),
      loadLiveJournal().catch(() => []),
      loadBotPrefs(),
    ]);

  const healthKv = kvHealth();
  const storageOk = Boolean(probe.ok && healthKv.ok);
  const storage = storageInfo();
  const liveCfg = getLiveConfig();
  const liveReady = isLiveEnvReady();

  const sessionToggles = liveTogglesFromPrefs(prefs);
  const botToggles = liveTogglesFromPrefs(botPrefs);
  // Ce que le cron utilise vraiment pour trader
  const liveTogglesOn = botToggles.on || sessionToggles.on;

  const paperOpen = paper.filter((t) => t.status === "open").length;
  const paperPending = paper.filter((t) => t.status === "pending").length;
  const liveOpen = liveJournal.filter((j) => j.status === "open");

  const cronAgeSec =
    cron?.at != null ? Math.round((now - cron.at) / 1000) : null;
  // Heartbeat récent = OK (même si note partial-bg — le tick a tourné)
  const cronFresh = cronAgeSec != null && cronAgeSec < 25 * 60;
  const cronOk = cronFresh;

  // —— Santé stockage ——
  if (!storageOk) {
    items.push({
      id: "health-storage",
      kind: "health",
      tone: "bad",
      title: "Paper bloqué (Redis)",
      detail:
        probe.error ||
        healthKv.error ||
        storage.note ||
        "Upstash KO — crée une nouvelle DB et mets URL+TOKEN dans Vercel.",
      at: now,
    });
  } else {
    items.push({
      id: "health-storage-ok",
      kind: "health",
      tone: "ok",
      title: "Stockage OK",
      detail: `Backend ${storage.backend} — paper & cron persistent.`,
      at: now,
    });
  }

  // —— Cron ——
  if (!cron) {
    items.push({
      id: "cron-missing",
      kind: "cron",
      tone: "warn",
      title: "Cron silencieux",
      detail: "Aucun heartbeat — vérifie cron-job.org → /api/cron.",
      at: now,
    });
  } else if (!cronFresh) {
    items.push({
      id: "cron-stale",
      kind: "cron",
      tone: "warn",
      title: "Cron en retard",
      detail: `Dernier tick il y a ${agoLabel(now - cron.at)} (${cron.tick ?? "?"} · ${cron.note ?? ""})`,
      at: cron.at,
    });
  } else {
    const partial =
      cron.ok === false || /partial/i.test(cron.note || "")
        ? " · tick partiel (OK)"
        : "";
    items.push({
      id: "cron-ok",
      kind: "cron",
      tone: "ok",
      title: "Cron actif",
      detail: `Tick ${cron.tick ?? "ok"} · il y a ${agoLabel(now - cron.at)}${cron.note ? ` · ${cron.note}` : ""}${partial}`,
      at: cron.at,
    });
  }

  // —— LIVE ——
  if (!liveCfg.envArmed) {
    items.push({
      id: "live-disarmed",
      kind: "live",
      tone: "info",
      title: "LIVE coupé (env)",
      detail: "HL_LIVE_ENABLED n’est pas true — paper seul.",
      at: now,
    });
  } else if (!liveReady.ok) {
    items.push({
      id: "live-not-ready",
      kind: "live",
      tone: "warn",
      title: "LIVE pas prêt",
      detail: liveReady.reason ?? "Clés / adresse manquantes",
      at: now,
    });
  } else if (!liveTogglesOn) {
    const missing: string[] = [];
    if (!botToggles.global && !sessionToggles.global) {
      missing.push("toggle global « trade live »");
    }
    if (!botToggles.boriaz && !sessionToggles.boriaz) {
      missing.push("toggle portefeuille Boriaz");
    }
    items.push({
      id: "live-toggles",
      kind: "live",
      tone: "warn",
      title: "LIVE armé — active les toggles Lab",
      detail:
        missing.length > 0
          ? `Manque : ${missing.join(" + ")}. Lab → enregistrer.`
          : "Active trade live global + Boriaz, puis Enregistrer.",
      at: now,
    });
  } else {
    const scopeNote = botToggles.on
      ? "bot prêt"
      : "session UI on (sync bot en cours)";
    items.push({
      id: "live-ready",
      kind: "live",
      tone: "ok",
      title: "LIVE prêt",
      detail: `${liveCfg.allowShort ? "Long+Short qualité" : "Long-only"} · ${liveOpen.length} pos. · ${scopeNote}`,
      at: now,
    });
  }

  for (const j of liveOpen.slice(0, 4)) {
    items.push({
      id: `live-open-${j.id}`,
      kind: "open",
      tone: "info",
      title: `LIVE ${j.side?.toUpperCase() ?? "?"} ${j.coin}`,
      detail: `Gère TP/SL · entrée ${j.entry ?? "—"}${j.tp ? ` · TP ${j.tp}` : ""}${j.sl ? ` · SL ${j.sl}` : ""}`,
      at: j.openedAt ?? now,
    });
  }

  // —— Paper ouvert / pending ——
  for (const t of paper.filter((x) => x.status === "pending").slice(0, 4)) {
    items.push({
      id: `paper-pend-${t.id}`,
      kind: "wait",
      tone: "info",
      title: `Paper attend ${t.side.toUpperCase()} ${t.coin}`,
      detail: `Limite @ ${t.entry} · en attente du fill`,
      at: t.openedAt,
    });
  }
  for (const t of paper.filter((x) => x.status === "open").slice(0, 4)) {
    const px = t.markPx ?? t.entry;
    items.push({
      id: `paper-open-${t.id}`,
      kind: "open",
      tone: "ok",
      title: `Paper ${t.side.toUpperCase()} ${t.coin}`,
      detail: `Ouvert @ ${t.entry} · mark ${px}${t.tp ? ` · vise TP ${t.tp}` : ""}${t.sl ? ` · SL ${t.sl}` : ""}`,
      at: t.openedAt,
    });
  }

  // —— Zones armées (attente entrée) ——
  for (const z of zones.slice(0, 5)) {
    items.push({
      id: `zone-${z.coin}-${z.side}`,
      kind: "wait",
      tone: "info",
      title: `Attend zone ${z.side.toUpperCase()} ${z.coin}`,
      detail: `Mid dans [${z.zoneLow}–${z.zoneHigh}] → scan force · entrée cible ${z.entry}`,
      at: z.at,
    });
  }

  // —— Journal récent (plans / wait) ——
  for (const e of journal.slice(0, 8)) {
    if (e.action === "wait") {
      items.push({
        id: `j-wait-${e.id}`,
        kind: "wait",
        tone: "info",
        title: `Pas d’entrée ${e.coin}`,
        detail:
          e.reason?.slice(0, 140) ||
          "Conditions SMC insuffisantes — on attend.",
        at: e.at,
      });
    } else if (e.action === "long" || e.action === "short") {
      items.push({
        id: `j-plan-${e.id}`,
        kind: "plan",
        tone: "ok",
        title: `Prévu ${e.action.toUpperCase()} ${e.coin}`,
        detail:
          e.justification?.slice(0, 140) ||
          e.reason?.slice(0, 140) ||
          `Conf ${e.confidence} · ${e.leverage} · ${e.sizePct}`,
        at: e.at,
      });
    }
  }

  // Dédup + tri (plus récent d’abord), cap 14
  const seen = new Set<string>();
  const unique = items.filter((i) => {
    if (seen.has(i.id)) return false;
    seen.add(i.id);
    return true;
  });
  unique.sort((a, b) => b.at - a.at);

  const liveOk = liveCfg.envArmed && liveReady.ok && liveTogglesOn;
  // Paper OK si Redis OK (un trade ouvert = preuve supplémentaire)
  const paperOk = storageOk;

  return {
    items: unique.slice(0, 14),
    health: {
      paperOk,
      liveOk,
      storageOk,
      cronOk,
      cronAgeSec,
      paperOpen,
      paperPending,
      livePositions: liveOpen.length,
      liveReady: liveReady.ok,
      liveArmed: liveCfg.envArmed,
      storageBackend: storage.backend,
      liveToggles: {
        global: botToggles.global || sessionToggles.global,
        boriaz: botToggles.boriaz || sessionToggles.boriaz,
        botScope: botToggles.on,
      },
    },
    fetchedAt: now,
  };
}
