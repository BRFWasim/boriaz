/**
 * Gate pré-trade LIVE Boriaz — « réfléchir » avant chaque ordre réel.
 * Paper peut être plus souple ; LIVE exige ORDRE PRÊT + IA + géométrie saine.
 */

import type { SmcSetup } from "./smc";
import type { SmcScanResult } from "./smc-scan";
import { fetchLivePortfolio } from "./hl-live";
import { loadLiveJournal, matchJournalToPosition } from "./live-journal";
import { postInfo } from "./hyperliquid";
import { parseNum } from "./format";

export type LiveSmcGateResult = {
  ok: boolean;
  reason: string;
  mid: number | null;
  checks: string[];
};

const lastLiveOpenAt = new Map<string, number>();
const GLOBAL_COOLDOWN_MS = 90_000;
const COIN_COOLDOWN_MS = 5 * 60_000;
let lastGlobalLiveOpenAt = 0;

export function noteLiveOpen(coin: string): void {
  const now = Date.now();
  lastGlobalLiveOpenAt = now;
  lastLiveOpenAt.set(coin.toUpperCase(), now);
}

function minLiveConfidence(setup: SmcSetup): number {
  if (setup.tradeKind === "correction" || setup.counterTrend) return 75;
  return 70;
}

function geometryOk(setup: SmcSetup): { ok: boolean; why: string } {
  const o = setup.order;
  if (!o) return { ok: false, why: "Pas d’ordre SMC" };
  if (!(o.entry > 0 && o.sl > 0 && o.tp1 > 0 && o.tp2 > 0)) {
    return { ok: false, why: "Entry/SL/TP invalides" };
  }
  if (o.entryMode !== "limit_wait") {
    return { ok: false, why: "LIVE SMC : LIMIT obligatoire (pas market)" };
  }
  const risk =
    o.side === "long" ? o.entry - o.sl : o.sl - o.entry;
  if (!(risk > 0)) return { ok: false, why: "SL du mauvais côté / risque ≤ 0" };
  const r1 =
    o.side === "long" ? o.tp1 - o.entry : o.entry - o.tp1;
  const r2 =
    o.side === "long" ? o.tp2 - o.entry : o.entry - o.tp2;
  if (Math.abs(r1 - risk) / risk > 0.08) {
    return { ok: false, why: "TP1 pas à ~1R" };
  }
  if (r2 + 1e-12 < risk * 1.95) {
    return { ok: false, why: "TP2 < 2R minimum" };
  }
  if (o.side === "long") {
    if (!(o.sl < o.entry && o.entry < o.tp1 && o.tp1 <= o.tp2)) {
      return { ok: false, why: "Ordre LONG SL < entry < TP1 ≤ TP2 requis" };
    }
  } else if (!(o.sl > o.entry && o.entry > o.tp1 && o.tp1 >= o.tp2)) {
    return { ok: false, why: "Ordre SHORT SL > entry > TP1 ≥ TP2 requis" };
  }
  return { ok: true, why: "géométrie OK" };
}

async function fetchMid(coin: string): Promise<number> {
  try {
    const mids = (await postInfo({ type: "allMids" })) as Record<string, string>;
    return parseNum(
      mids[coin] ?? mids[coin.toUpperCase()] ?? mids[coin.toLowerCase()] ?? "0",
    );
  } catch {
    return 0;
  }
}

/**
 * Double-check avant placeBoriazLiveTrade.
 * Refuse si setup pas prêt, IA absente/faible, cooldown, position déjà ouverte, etc.
 */
export async function validateLiveSmcBeforePlace(opts: {
  setup: SmcSetup;
  scan: SmcScanResult;
}): Promise<LiveSmcGateResult> {
  const checks: string[] = [];
  const { setup, scan } = opts;

  if (!setup.checklist.allPass) {
    return {
      ok: false,
      reason: "SETUP INVALIDÉ (CRITÈRE MANQUANT) - AUCUN ORDRE",
      mid: null,
      checks,
    };
  }
  checks.push("checklist 4/4");

  if (setup.status !== "ORDRE PRÊT À ÊTRE EXÉCUTÉ") {
    return {
      ok: false,
      reason: `LIVE refuse statut « ${setup.status} » — attendre zone ÔTE/FVG (ORDRE PRÊT)`,
      mid: null,
      checks,
    };
  }
  checks.push("statut ORDRE PRÊT");

  if (!setup.order || !setup.risk) {
    return {
      ok: false,
      reason: "Pas de plan d’ordre / risque",
      mid: null,
      checks,
    };
  }

  if (setup.tradeKind === "correction" && setup.execTimeframe === "5m") {
    return {
      ok: false,
      reason: "Correction interdite en M5",
      mid: null,
      checks,
    };
  }
  checks.push(`TF ${setup.execTimeframe ?? "?"} OK`);

  const geo = geometryOk(setup);
  if (!geo.ok) {
    return { ok: false, reason: geo.why, mid: null, checks };
  }
  checks.push(geo.why);

  if (!scan.aiApproved) {
    return {
      ok: false,
      reason: `Gate IA refuse : ${scan.aiNote || "non approuvé"}`,
      mid: null,
      checks,
    };
  }
  if (scan.model === "mechanical-smc" || !/chatgpt|gpt|openai/i.test(scan.model)) {
    return {
      ok: false,
      reason:
        "LIVE exige ChatGPT (pas de gate mécanique) — configure OPENAI_API_KEY",
      mid: null,
      checks,
    };
  }
  checks.push(`IA ${scan.model}`);

  const minConf = minLiveConfidence(setup);
  const conf = Math.max(setup.confidence, scan.aiConfidence ?? 0);
  if (conf < minConf) {
    return {
      ok: false,
      reason: `Confiance ${conf} < seuil LIVE ${minConf}`,
      mid: null,
      checks,
    };
  }
  checks.push(`confiance ${conf} ≥ ${minConf}`);

  if (!scan.liveEligible) {
    return {
      ok: false,
      reason: `Scan non liveEligible — ${scan.aiNote || "conditions LIVE incomplètes"}`,
      mid: null,
      checks,
    };
  }
  checks.push("liveEligible");

  const now = Date.now();
  if (now - lastGlobalLiveOpenAt < GLOBAL_COOLDOWN_MS) {
    const wait = Math.ceil((GLOBAL_COOLDOWN_MS - (now - lastGlobalLiveOpenAt)) / 1000);
    return {
      ok: false,
      reason: `Cooldown global LIVE encore ${wait}s — on réfléchit entre les trades`,
      mid: null,
      checks,
    };
  }
  const coinLast = lastLiveOpenAt.get(setup.coin.toUpperCase()) ?? 0;
  if (now - coinLast < COIN_COOLDOWN_MS) {
    const wait = Math.ceil((COIN_COOLDOWN_MS - (now - coinLast)) / 1000);
    return {
      ok: false,
      reason: `Cooldown ${setup.coin} encore ${wait}s`,
      mid: null,
      checks,
    };
  }
  checks.push("cooldown OK");

  const mid = await fetchMid(setup.coin);
  if (!(mid > 0)) {
    return {
      ok: false,
      reason: `Prix mid ${setup.coin} indisponible — pas d’ordre LIVE à l’aveugle`,
      mid: null,
      checks,
    };
  }
  checks.push(`mid ${mid}`);

  const o = setup.order;
  const zoneLow = Math.min(
    setup.ote?.low ?? o.entry,
    setup.fvg?.low ?? o.entry,
  );
  const zoneHigh = Math.max(
    setup.ote?.high ?? o.entry,
    setup.fvg?.high ?? o.entry,
  );
  // Mid doit être près de la zone d’entrée (LIMIT) — pas déjà au TP / au-delà SL
  if (o.side === "long") {
    if (mid <= o.sl) {
      return {
        ok: false,
        reason: `Mid ${mid} ≤ SL ${o.sl} — setup mort`,
        mid,
        checks,
      };
    }
    if (mid >= o.tp1) {
      return {
        ok: false,
        reason: `Mid ${mid} déjà ≥ TP1 — trop tard pour entrer`,
        mid,
        checks,
      };
    }
    if (mid > zoneHigh * 1.004) {
      return {
        ok: false,
        reason: `Mid hors zone ÔTE/FVG haute — attendre retracement`,
        mid,
        checks,
      };
    }
  } else {
    if (mid >= o.sl) {
      return {
        ok: false,
        reason: `Mid ${mid} ≥ SL ${o.sl} — setup mort`,
        mid,
        checks,
      };
    }
    if (mid <= o.tp1) {
      return {
        ok: false,
        reason: `Mid ${mid} déjà ≤ TP1 — trop tard pour entrer`,
        mid,
        checks,
      };
    }
    if (mid < zoneLow * 0.996) {
      return {
        ok: false,
        reason: `Mid hors zone ÔTE/FVG basse — attendre retracement`,
        mid,
        checks,
      };
    }
  }
  checks.push("mid dans fenêtre SL/TP + zone");

  // Pas de position HL déjà ouverte sur ce coin
  try {
    const pf = await fetchLivePortfolio();
    if (pf.ok) {
      const hit = pf.positions.find(
        (p) => p.coin.toUpperCase() === setup.coin.toUpperCase(),
      );
      if (hit) {
        return {
          ok: false,
          reason: `Position HL déjà ouverte ${hit.coin} ${hit.side} — pas de double entrée`,
          mid,
          checks,
        };
      }
    }
  } catch {
    /* best-effort */
  }
  checks.push("pas de position HL existante");

  // Pas de journal open déjà
  try {
    const journal = (await loadLiveJournal()).filter((e) => e.status === "open");
    const j = matchJournalToPosition(journal, setup.coin, setup.order.side);
    if (j) {
      return {
        ok: false,
        reason: `Journal LIVE déjà open ${j.coin} ${j.side}`,
        mid,
        checks,
      };
    }
  } catch {
    /* best-effort */
  }
  checks.push("journal libre");

  return {
    ok: true,
    reason: "LIVE gate OK — prêt à placer (Boriaz)",
    mid,
    checks,
  };
}
