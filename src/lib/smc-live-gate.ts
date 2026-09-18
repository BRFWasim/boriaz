/**
 * Gate pré-trade LIVE Boriaz — « réfléchir » avant chaque ordre réel.
 * Paper peut être plus souple ; LIVE exige ORDRE PRÊT + IA + géométrie saine.
 */

import type { SmcSetup } from "./smc";
import { minSlDistancePct } from "./smc";
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

const GLOBAL_COOLDOWN_MS = 3 * 60_000; // 3 min entre trades globaux
const COIN_COOLDOWN_MS = 45 * 60_000; // 45 min même coin après open
/** Après un stop-out OU un close (TP) : pas de revenge / spam 3h sur le coin. */
const STOPOUT_COIN_COOLDOWN_MS = 3 * 60 * 60_000;
const STOPOUT_GLOBAL_COOLDOWN_MS = 20 * 60_000;
const COOLDOWN_GLOBAL_KEY = "boriaz:live-cd:global";
const coinCooldownKey = (coin: string) =>
  `boriaz:live-cd:${coin.toUpperCase()}`;
const coinStopKey = (coin: string) =>
  `boriaz:live-stopout:${coin.toUpperCase()}`;
const GLOBAL_STOP_KEY = "boriaz:live-stopout:global";

export function noteLiveOpen(coin: string): void {
  const now = Date.now();
  void import("./arch-guards").then(({ setDurableCooldown }) => {
    void setDurableCooldown(COOLDOWN_GLOBAL_KEY, now, 180);
    void setDurableCooldown(coinCooldownKey(coin), now, 3600);
  });
}

function minLiveConfidence(setup: SmcSetup): number {
  // Plus exigeant : sûr et certain avant d’engager du vrai $ 
  if (setup.tradeKind === "correction" || setup.counterTrend) return 88;
  if (setup.entryStyle === "shallow" || setup.h4Lead) return 86;
  return 82;
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
  const minPct = minSlDistancePct(o.entry);
  if (risk / o.entry < minPct * 0.95) {
    return {
      ok: false,
      why: `SL trop serré (${((risk / o.entry) * 100).toFixed(2)}% < min ${(minPct * 100).toFixed(1)}%) — noise-stop`,
    };
  }
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

  const isReady = setup.status === "ORDRE PRÊT À ÊTRE EXÉCUTÉ";
  const isWaitingArm =
    setup.status === "EN ATTENTE DE RETRACEMENT" &&
    setup.tradeKind === "continuation" &&
    !setup.counterTrend;

  if (!isReady && !isWaitingArm) {
    return {
      ok: false,
      reason: `LIVE refuse statut « ${setup.status} » — ORDRE PRÊT ou EN ATTENTE continuation requis`,
      mid: null,
      checks,
    };
  }
  checks.push(isReady ? "statut ORDRE PRÊT" : "statut EN ATTENTE · pré-arm GTC");

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

  // Range BTC / coin — jamais short en bas de range, jamais long en haut
  try {
    const { getTradeRangeGate } = await import("./btc-range");
    const rg = await getTradeRangeGate({
      coin: setup.coin,
      side: setup.order.side,
      price: setup.price,
      tradeKind: setup.tradeKind,
    });
    checks.push(`range ${rg.btc.summary}`);
    if (!rg.ok) {
      return {
        ok: false,
        reason: rg.reason,
        mid: null,
        checks,
      };
    }
  } catch (e) {
    return {
      ok: false,
      reason: `Range indisponible — pas de LIVE à l’aveugle (${e instanceof Error ? e.message : "err"})`,
      mid: null,
      checks,
    };
  }
  checks.push("range OK");

  const { getDurableCooldown } = await import("./arch-guards");
  const now = Date.now();
  const lastStopGlobal = await getDurableCooldown(GLOBAL_STOP_KEY);
  if (
    lastStopGlobal > 0 &&
    now - lastStopGlobal < STOPOUT_GLOBAL_COOLDOWN_MS
  ) {
    const wait = Math.ceil(
      (STOPOUT_GLOBAL_COOLDOWN_MS - (now - lastStopGlobal)) / 1000,
    );
    return {
      ok: false,
      reason: `Cooldown post-stop global encore ${wait}s — on digère la perte`,
      mid: null,
      checks,
    };
  }
  const lastStopCoin = await getDurableCooldown(coinStopKey(setup.coin));
  if (
    lastStopCoin > 0 &&
    now - lastStopCoin < STOPOUT_COIN_COOLDOWN_MS
  ) {
    const waitMin = Math.ceil(
      (STOPOUT_COIN_COOLDOWN_MS - (now - lastStopCoin)) / 60_000,
    );
    return {
      ok: false,
      reason: `Cooldown post-stop ${setup.coin} encore ~${waitMin} min — pas de revenge trade`,
      mid: null,
      checks,
    };
  }
  const lastGlobal = await getDurableCooldown(COOLDOWN_GLOBAL_KEY);
  if (lastGlobal > 0 && now - lastGlobal < GLOBAL_COOLDOWN_MS) {
    const wait = Math.ceil((GLOBAL_COOLDOWN_MS - (now - lastGlobal)) / 1000);
    return {
      ok: false,
      reason: `Cooldown global LIVE encore ${wait}s — on réfléchit entre les trades`,
      mid: null,
      checks,
    };
  }
  const coinLast = await getDurableCooldown(coinCooldownKey(setup.coin));
  if (coinLast > 0 && now - coinLast < COIN_COOLDOWN_MS) {
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

  // Refuse limite « marketable » (short entry sous mid = fill immédiat taker)
  {
    const o0 = setup.order;
    if (o0.side === "short" && o0.entry < mid * 0.999) {
      return {
        ok: false,
        reason: `Limite short ${o0.entry} < mid ${mid} — fill marché immédiat interdit`,
        mid,
        checks,
      };
    }
    if (o0.side === "long" && o0.entry > mid * 1.001) {
      return {
        ok: false,
        reason: `Limite long ${o0.entry} > mid ${mid} — fill marché immédiat interdit`,
        mid,
        checks,
      };
    }
  }

  const o = setup.order;
  const zoneLow = Math.min(
    setup.ote?.low ?? o.entry,
    setup.fvg?.low ?? o.entry,
  );
  const zoneHigh = Math.max(
    setup.ote?.high ?? o.entry,
    setup.fvg?.high ?? o.entry,
  );

  if (isWaitingArm) {
    // Pré-arm GTC : le prix DOIT être hors zone (sinon ce serait ORDRE PRÊT).
    // Long : mid au-dessus de la zone → limite en dessous attend le pullback.
    // Short : mid en-dessous → limite au-dessus attend le rebond.
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
          reason: `Mid ${mid} déjà ≥ TP1 — trop tard pour pré-armer`,
          mid,
          checks,
        };
      }
      if (mid <= zoneHigh * 1.002) {
        return {
          ok: false,
          reason: `Mid déjà près/dans zone — passer en ORDRE PRÊT, pas pré-arm`,
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
          reason: `Mid ${mid} déjà ≤ TP1 — trop tard pour pré-armer`,
          mid,
          checks,
        };
      }
      if (mid >= zoneLow * 0.998) {
        return {
          ok: false,
          reason: `Mid déjà près/dans zone — passer en ORDRE PRÊT, pas pré-arm`,
          mid,
          checks,
        };
      }
    }
    checks.push("pré-arm GTC hors zone OK");
  } else {
    // ORDRE PRÊT : mid dans / près de la zone
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
      if (mid > zoneHigh * 1.01) {
        return {
          ok: false,
          reason: `Mid hors zone ÔTE/FVG haute — pré-armer ou attendre`,
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
      if (mid < zoneLow * 0.99) {
        return {
          ok: false,
          reason: `Mid hors zone ÔTE/FVG basse — pré-armer ou attendre`,
          mid,
          checks,
        };
      }
    }
    checks.push("mid dans fenêtre SL/TP + zone");
  }

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
