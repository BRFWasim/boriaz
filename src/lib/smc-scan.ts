/**
 * Scan SMC multi-coins + gate ChatGPT pour Boriaz.
 * Claude Haiku : code conservé mais commenté / non appelé.
 */
import { loadCandles } from "./market-analysis";
import {
  analyzeSmcSetup,
  BORIAZ_SMC_SYSTEM_PROMPT,
  type SmcSetup,
} from "./smc";
import { WATCHLIST } from "./price-watch";
import { isLiveSideAllowed } from "./live-side-policy";
import { minGateConfidenceForSide, isQualityShortSetup } from "./live-side-policy";

const CLAUDE_MODEL = "claude-haiku-4-5-20251001";
const GPT_MODEL_DEFAULT = "gpt-4o-mini";

const SCAN_CACHE_TTL = 30_000;
let scanCache: { key: string; at: number; value: SmcScanResult } | null = null;

export interface SmcScanResult {
  setups: SmcSetup[];
  best: SmcSetup | null;
  /** Setups actionnables (checklist OK) avant gate IA. */
  actionable: SmcSetup[];
  aiApproved: boolean;
  aiNote: string | null;
  aiReport: string | null;
  model: string;
  fetchedAt: number;
  /** Combien de candidats ont été testés au gate. */
  gatedTried: number;
  /** Confiance renvoyée par la gate IA (0 si mécanique). */
  aiConfidence: number;
  /**
   * true seulement si prêt pour LIVE :
   * ORDRE PRÊT + IA ChatGPT + conf suffisante.
   */
  liveEligible: boolean;
}

type GateResult = {
  approved: boolean;
  confidence: number;
  note: string;
  report: string | null;
  provider: string;
};

function minGateConfidence(setup: SmcSetup): number {
  return minGateConfidenceForSide(setup);
}

function parseGateJson(
  text: string,
  setup: SmcSetup,
  provider: string,
): GateResult {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  let approved = false;
  let confidence = 0;
  let note = `Réponse ${provider} illisible`;
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      approved = Boolean(obj.approve);
      confidence = Number(obj.confidence ?? 0);
      note = String(obj.note || "");
      const minConf = minGateConfidence(setup);
      if (approved && confidence < minConf) {
        approved = false;
        note = note || `Confiance ${provider} < ${minConf} — bloqué.`;
      }
    } catch {
      approved = false;
    }
  }
  if (approved && !setup.checklist.allPass) {
    approved = false;
    note = `${provider} OK mais checklist SMC mécanique incomplète.`;
  }
  // ORDRE PRÊT = fill immédiat possible ; EN ATTENTE continuation = pré-armer GTC
  if (
    approved &&
    setup.status !== "ORDRE PRÊT À ÊTRE EXÉCUTÉ" &&
    !(
      setup.status === "EN ATTENTE DE RETRACEMENT" &&
      setup.tradeKind === "continuation" &&
      !setup.counterTrend
    )
  ) {
    approved = false;
    note =
      note ||
      `${provider}: statut ${setup.status} — attendre ORDRE PRÊT ou EN ATTENTE continuation.`;
  }
  const reportBlock = text.includes("[ANALYSE")
    ? text.replace(/\n?\s*\{[\s\S]*\}\s*$/, "").trim()
    : setup.report;
  return {
    approved,
    confidence,
    note:
      note ||
      (approved
        ? `${provider} valide le setup SMC.`
        : `${provider} refuse.`),
    report: reportBlock || setup.report,
    provider,
  };
}

function smcGatePrompt(setup: SmcSetup, rangeNote?: string): string {
  const side = setup.order?.side?.toUpperCase() ?? "?";
  return `${BORIAZ_SMC_SYSTEM_PROMPT}

MISSION : FAIRE GAGNER DE L'ARGENT — refuse tout trade douteux.

Coin: ${setup.coin}
Sens proposé: ${side}
Prix: ${setup.price}
Kind: ${setup.tradeKind ?? "?"}
Range / macro fourni: ${rangeNote || "non fourni — déduis depuis le rapport"}

Analyse déterministe déjà calculée (à valider ou corriger) :

${setup.report}

Si TOUTE la checklist structure est VALIDÉE (Sweep + BOS corps + FVG + ÔTE)
ET (statut « ORDRE PRÊT À ÊTRE EXÉCUTÉ » OU « EN ATTENTE DE RETRACEMENT » en CONTINUATION — pour pré-armer une limite GTC en zone)
ET le range BTC/actif n’interdit PAS ce sens (pas de SHORT en vrai bas, pas de LONG en haut D1)
ET l’espérance de gain est claire,
approve=true.
Si EN ATTENTE en CORRECTION / counter-trend → approve=false (pas de limite spéculative).
Si short en vrai bas de range ou long en haut de range → approve=false.
Correction/retracement OK seulement en M15/M30 (pas M5). Un seul critère manquant → approve=false.
Sinon approve=false.
Réponds d'abord avec le format [ANALYSE...] complet, puis UNE ligne JSON : {"approve":true|false,"confidence":0-100,"note":"..."}`;
}

async function askClaudeSmcGate(setup: SmcSetup): Promise<GateResult | null> {
  // Claude désactivé — non appelé (gardé pour réactivation future).
  void setup;
  return null;
  /*
  const anthropic = process.env.ANTHROPIC_API_KEY?.trim();
  if (!anthropic) return null;
  ...
  */
}

async function askGptSmcGate(
  setup: SmcSetup,
  rangeNote?: string,
): Promise<GateResult | null> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return null;

  const { canCallAi, noteAiCall, noteAiFailure, noteAiSuccess } = await import(
    "./arch-guards"
  );
  const budget = await canCallAi(
    // Checklist 100% + ORDRE PRÊT → on laisse ChatGPT trancher même si conf mécanique ~70
    Math.max(
      setup.confidence,
      setup.checklist.allPass &&
      (setup.status === "ORDRE PRÊT À ÊTRE EXÉCUTÉ" ||
        (setup.status === "EN ATTENTE DE RETRACEMENT" &&
          setup.tradeKind === "continuation"))
        ? 75
        : 0,
    ),
  );
  if (!budget.ok) {
    return {
      approved: false,
      confidence: 0,
      note: budget.reason,
      report: setup.report,
      provider: "chatgpt",
    };
  }

  const model = process.env.OPENAI_MODEL?.trim() || GPT_MODEL_DEFAULT;
  const timeoutMs = Number(process.env.AI_TIMEOUT_MS?.trim()) || 12_000;
  try {
    await noteAiCall();
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 1600,
        messages: [
          {
            role: "system",
            content: `${BORIAZ_SMC_SYSTEM_PROMPT}\n\nRAPPEL SYSTÈME: FAIRE GAGNER DE L'ARGENT — refuse les setups incohérents avec le range macro.`,
          },
          { role: "user", content: smcGatePrompt(setup, rangeNote) },
        ],
      }),
      signal: AbortSignal.timeout(Math.max(2500, timeoutMs)),
    });
    if (!res.ok) {
      await noteAiFailure();
      const errTxt = await res.text().catch(() => "");
      return {
        approved: false,
        confidence: 0,
        note: `ChatGPT HTTP ${res.status} ${errTxt.slice(0, 80)}`,
        report: setup.report,
        provider: "chatgpt",
      };
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = json.choices?.[0]?.message?.content || "";
    const parsed = parseGateJson(text, setup, "chatgpt");
    if (!text || parsed.note.includes("illisible")) {
      await noteAiFailure();
    } else {
      await noteAiSuccess();
    }
    return parsed;
  } catch (e) {
    await noteAiFailure();
    return {
      approved: false,
      confidence: 0,
      note: e instanceof Error ? e.message : "Erreur ChatGPT",
      report: setup.report,
      provider: "chatgpt",
    };
  }
}

/**
 * Validation Boriaz : ChatGPT uniquement.
 * Sans OPENAI_API_KEY → gate mécanique checklist.
 */
async function runSmcAiGates(
  setup: SmcSetup,
  rangeNote?: string,
): Promise<{
  approved: boolean;
  note: string;
  report: string | null;
  model: string;
  confidence: number;
}> {
  const gpt = await askGptSmcGate(setup, rangeNote);
  void askClaudeSmcGate;
  void CLAUDE_MODEL;
  const gates = [gpt].filter(Boolean) as GateResult[];

  if (!gates.length) {
    // Sans ChatGPT : paper peut suivre la checklist, LIVE refusera (mechanical).
    const approved =
      setup.checklist.allPass &&
      setup.status === "ORDRE PRÊT À ÊTRE EXÉCUTÉ";
    return {
      approved,
      note: approved
        ? "Gate mécanique SMC (pas de clé ChatGPT) — LIVE bloqué sans IA."
        : "Checklist SMC incomplète ou pas ORDRE PRÊT — bloqué.",
      report: setup.report,
      model: "mechanical-smc",
      confidence: setup.confidence,
    };
  }

  const approved = gates.every((g) => g.approved);
  const notes = gates.map((g) => `${g.provider}: ${g.note}`).join(" · ");
  const report = gates.find((g) => g.report)?.report || setup.report;
  const confidence = Math.max(...gates.map((g) => g.confidence), 0);
  const model = gates.map((g) => g.provider).join("+");

  return {
    approved,
    note: approved
      ? `Validé (${model}) — ${notes}`
      : `Refusé (${model}) — ${notes}`,
    report,
    model,
    confidence,
  };
}

/** Ordre des candidats : CONTINUATION d’abord (FAIRE GAGNER), puis corrections. */
function pickGateCandidates(actionable: SmcSetup[]): SmcSetup[] {
  if (!actionable.length) return [];
  // Respecte Long-only (HL_ALLOW_SHORT=false)
  const pool = actionable.filter(
    (s) =>
      s.order &&
      isLiveSideAllowed(s.order.side) &&
      isQualityShortSetup(s),
  );
  if (!pool.length) return [];
  const ranked = [...pool].sort((a, b) => {
    const cont = (s: SmcSetup) =>
      s.tradeKind === "continuation" && !s.counterTrend ? 2 : 0;
    const longBias = (s: SmcSetup) =>
      s.order?.side === "long" && s.tradeKind === "continuation" ? 1 : 0;
    return cont(b) + longBias(b) - (cont(a) + longBias(a)) || b.confidence - a.confidence;
  });
  const out: SmcSetup[] = [];
  const seen = new Set<string>();
  const push = (s: SmcSetup | undefined) => {
    if (!s?.order) return;
    const k = `${s.coin}:${s.order.side}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(s);
  };
  for (const s of ranked) {
    if (out.length >= 4) break;
    push(s);
  }
  return out;
}

export async function scanSmcWatchlist(input: {
  coins?: string[];
  walletEur: number;
  maxLeverage?: number;
  prices?: Record<string, number>;
  force?: boolean;
}): Promise<SmcScanResult> {
  const coins =
    input.coins?.length
      ? input.coins
      : WATCHLIST.map((w) => w.coin).slice(0, 16);

  const cacheKey = `${coins.join(",")}:${Math.round(input.walletEur)}`;
  if (
    !input.force &&
    scanCache &&
    scanCache.key === cacheKey &&
    Date.now() - scanCache.at < SCAN_CACHE_TTL
  ) {
    return scanCache.value;
  }

  const setups: SmcSetup[] = [];

  for (let i = 0; i < coins.length; i += 2) {
    const batch = coins.slice(i, i + 2);
    const part = await Promise.all(
      batch.map(async (coin) => {
        try {
          const [d1, h4, h1, m5, m15, m30] = await Promise.all([
            loadCandles(coin, "1d"),
            loadCandles(coin, "4h"),
            loadCandles(coin, "1h"),
            loadCandles(coin, "5m"),
            loadCandles(coin, "15m"),
            loadCandles(coin, "30m"),
          ]);
          if (d1.length < 30 || h4.length < 30 || h1.length < 30) {
            return null;
          }
          const price =
            input.prices?.[coin] ??
            m15.at(-1)?.c ??
            m5.at(-1)?.c ??
            h1.at(-1)?.c ??
            0;
          if (!(price > 0)) return null;

          // Essayer M5 / M15 / M30 — garder le meilleur setup actionable
          const execCandidates: {
            tf: "5m" | "15m" | "30m";
            candles: typeof m15;
          }[] = (
            [
              { tf: "5m" as const, candles: m5 },
              { tf: "15m" as const, candles: m15 },
              { tf: "30m" as const, candles: m30 },
            ] as const
          ).filter((e) => e.candles.length >= 25);

          let bestLocal: ReturnType<typeof analyzeSmcSetup> | null = null;
          for (const ex of execCandidates) {
            const s = analyzeSmcSetup({
              coin,
              price,
              candlesD1: d1,
              candlesH4: h4,
              candlesH1: h1,
              candlesExec: ex.candles,
              walletEur: input.walletEur,
              maxLeverage: input.maxLeverage ?? 8,
              execTimeframe: ex.tf,
            });
            if (!bestLocal) {
              bestLocal = s;
              continue;
            }
            const betterPass =
              s.checklist.allPass && !bestLocal.checklist.allPass;
            const contBonus =
              (s.tradeKind === "continuation" ? 3 : 0) -
              (bestLocal.tradeKind === "continuation" ? 3 : 0);
            const sameTier =
              s.checklist.allPass === bestLocal.checklist.allPass &&
              s.confidence + contBonus > bestLocal.confidence;
            // Correction interdite sur M5 (déjà filtré dans analyze) — privilégier M15/M30 si égalité
            if (betterPass || sameTier) bestLocal = s;
          }
          return bestLocal;
        } catch {
          return null;
        }
      }),
    );
    for (const s of part) if (s) setups.push(s);
  }

  const actionable = setups
    .filter(
      (s) =>
        s.checklist.allPass &&
        (s.status === "ORDRE PRÊT À ÊTRE EXÉCUTÉ" ||
          s.status === "EN ATTENTE DE RETRACEMENT"),
    )
    .sort((a, b) => {
      // Privilégier ORDRE PRÊT pour exécution
      const tier = (s: SmcSetup) =>
        s.status === "ORDRE PRÊT À ÊTRE EXÉCUTÉ" ? 2 : 1;
      return tier(b) - tier(a) || b.confidence - a.confidence;
    });

  let best: SmcSetup | null =
    actionable[0] ??
    setups.slice().sort((a, b) => b.confidence - a.confidence)[0] ??
    null;

  let aiApproved = false;
  let aiNote: string | null = null;
  let aiReport: string | null = null;
  let model = "mechanical-smc";
  let gatedTried = 0;
  let aiConfidence = 0;

  // Gate IA : ORDRE PRÊT d’abord, sinon EN ATTENTE continuation (pré-arm GTC)
  const readyForGate = actionable.filter(
    (s) => s.status === "ORDRE PRÊT À ÊTRE EXÉCUTÉ",
  );
  const waitingCont = actionable.filter(
    (s) =>
      s.status === "EN ATTENTE DE RETRACEMENT" &&
      s.tradeKind === "continuation" &&
      !s.counterTrend,
  );
  const candidates = pickGateCandidates(
    readyForGate.length ? readyForGate : waitingCont,
  );
  const refusals: string[] = [];

  const { getTradeRangeGate } = await import("./btc-range");

  for (const cand of candidates) {
    if (!cand.order || !cand.checklist.allPass) continue;

    // Filtre range BTC / coin AVANT ChatGPT — FAIRE GAGNER = pas de short bas de range
    let rangeNote = "";
    try {
      const rg = await getTradeRangeGate({
        coin: cand.coin,
        side: cand.order.side,
        price: cand.price,
        tradeKind: cand.tradeKind,
      });
      rangeNote = `${rg.reason} | BTC: ${rg.btc.summary}`;
      if (!rg.ok) {
        gatedTried += 1;
        refusals.push(
          `${cand.coin} ${cand.order.side}: RANGE ${rg.reason}`.slice(0, 140),
        );
        aiNote = `Range refuse — ${rg.reason}`;
        continue;
      }
    } catch (e) {
      rangeNote = e instanceof Error ? e.message : "range err";
    }

    gatedTried += 1;
    const gate = await runSmcAiGates(cand, rangeNote);
    if (gate.approved) {
      best = cand;
      aiApproved = true;
      aiNote = `${gate.note} · ${rangeNote}`;
      aiReport = gate.report;
      model = gate.model;
      aiConfidence = gate.confidence;
      if (gate.report) cand.report = gate.report;
      cand.confidence = Math.min(
        95,
        Math.round((cand.confidence + gate.confidence) / 2),
      );
      break;
    }
    refusals.push(
      `${cand.coin} ${cand.order.side}: ${gate.note}`.slice(0, 120),
    );
    aiNote = gate.note;
    aiReport = gate.report;
    model = gate.model;
    aiConfidence = gate.confidence;
  }

  if (!aiApproved && candidates.length) {
    aiNote = `Aucun candidat validé (${gatedTried}) — ${refusals.slice(0, 3).join(" · ")}`;
  } else if (!candidates.length && best) {
    aiNote =
      best.status === "EN ATTENTE DE RETRACEMENT"
        ? "EN ATTENTE — structure OK, prix hors zone (pré-arm si continuation + IA)"
        : best.cancelReason || "Setup SMC non actionnable";
  }

  const liveEligible =
    aiApproved &&
    best != null &&
    best.checklist.allPass &&
    (best.status === "ORDRE PRÊT À ÊTRE EXÉCUTÉ" ||
      (best.status === "EN ATTENTE DE RETRACEMENT" &&
        best.tradeKind === "continuation" &&
        !best.counterTrend)) &&
    best.order?.entryMode === "limit_wait" &&
    model !== "mechanical-smc" &&
    aiConfidence >= minGateConfidence(best);

  const value: SmcScanResult = {
    setups: setups.sort((a, b) => b.confidence - a.confidence),
    best,
    actionable,
    aiApproved,
    aiNote,
    aiReport,
    model,
    fetchedAt: Date.now(),
    gatedTried,
    aiConfidence,
    liveEligible,
  };
  scanCache = { key: cacheKey, at: Date.now(), value };
  return value;
}
