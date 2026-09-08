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
}

type GateResult = {
  approved: boolean;
  confidence: number;
  note: string;
  report: string | null;
  provider: string;
};

function minGateConfidence(setup: SmcSetup): number {
  // Shorts structurels : seuil un peu plus bas (modèles trop « bull-biased »)
  if (
    setup.order?.side === "short" &&
    setup.bias.d1 === "baissier" &&
    setup.checklist.allPass
  ) {
    return 58;
  }
  return 62;
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

function smcGatePrompt(setup: SmcSetup): string {
  const side = setup.order?.side?.toUpperCase() ?? "?";
  return `${BORIAZ_SMC_SYSTEM_PROMPT}

Coin: ${setup.coin}
Sens proposé: ${side}
Prix: ${setup.price}
Analyse déterministe déjà calculée (à valider ou corriger) :

${setup.report}

Si TOUTE la checklist structure est VALIDÉE et le statut est ORDRE PRÊT ou EN ATTENTE DE RETRACEMENT, approve=true — y compris pour un SHORT baissier.
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

async function askGptSmcGate(setup: SmcSetup): Promise<GateResult | null> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return null;
  const model = process.env.OPENAI_MODEL?.trim() || GPT_MODEL_DEFAULT;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 1400,
        messages: [
          { role: "system", content: BORIAZ_SMC_SYSTEM_PROMPT },
          { role: "user", content: smcGatePrompt(setup) },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) {
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
    return parseGateJson(text, setup, "chatgpt");
  } catch (e) {
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
async function runSmcAiGates(setup: SmcSetup): Promise<{
  approved: boolean;
  note: string;
  report: string | null;
  model: string;
  confidence: number;
}> {
  const gpt = await askGptSmcGate(setup);
  void askClaudeSmcGate;
  void CLAUDE_MODEL;
  const gates = [gpt].filter(Boolean) as GateResult[];

  if (!gates.length) {
    const approved = setup.checklist.allPass && setup.status !== "ANNULÉ";
    return {
      approved,
      note: approved
        ? "Gate mécanique SMC 6/6 (pas de clé ChatGPT)."
        : "Checklist SMC incomplète — bloqué.",
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

/** Ordre des candidats : meilleur, meilleur côté opposé, puis suivants. */
function pickGateCandidates(actionable: SmcSetup[]): SmcSetup[] {
  if (!actionable.length) return [];
  const out: SmcSetup[] = [];
  const seen = new Set<string>();
  const push = (s: SmcSetup | undefined) => {
    if (!s?.order) return;
    const k = `${s.coin}:${s.order.side}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(s);
  };
  push(actionable[0]);
  const topSide = actionable[0]?.order?.side;
  if (topSide) {
    push(actionable.find((s) => s.order?.side && s.order.side !== topSide));
  }
  // Favoriser un short structurel s’il n’est pas déjà en tête
  push(
    actionable.find(
      (s) =>
        s.order?.side === "short" &&
        s.bias.d1 === "baissier" &&
        s.checklist.allPass,
    ),
  );
  for (const s of actionable) {
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
      : WATCHLIST.map((w) => w.coin).slice(0, 10);

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
          const [d1, h4, h1, m15, m30] = await Promise.all([
            loadCandles(coin, "1d"),
            loadCandles(coin, "4h"),
            loadCandles(coin, "1h"),
            loadCandles(coin, "15m"),
            loadCandles(coin, "30m"),
          ]);
          const exec =
            m15.length >= 40 ? m15 : m30.length >= 30 ? m30 : m15;
          if (
            d1.length < 30 ||
            h4.length < 30 ||
            h1.length < 30 ||
            exec.length < 25
          ) {
            return null;
          }
          const price =
            input.prices?.[coin] ??
            exec.at(-1)?.c ??
            h1.at(-1)?.c ??
            0;
          if (!(price > 0)) return null;
          return analyzeSmcSetup({
            coin,
            price,
            candlesD1: d1,
            candlesH4: h4,
            candlesH1: h1,
            candlesExec: exec,
            walletEur: input.walletEur,
            maxLeverage: input.maxLeverage ?? 3,
          });
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
    .sort((a, b) => b.confidence - a.confidence);

  let best: SmcSetup | null =
    actionable[0] ??
    setups.slice().sort((a, b) => b.confidence - a.confidence)[0] ??
    null;

  let aiApproved = false;
  let aiNote: string | null = null;
  let aiReport: string | null = null;
  let model = "mechanical-smc";
  let gatedTried = 0;

  const candidates = pickGateCandidates(actionable);
  const refusals: string[] = [];

  for (const cand of candidates) {
    if (!cand.order || !cand.checklist.allPass) continue;
    gatedTried += 1;
    const gate = await runSmcAiGates(cand);
    if (gate.approved) {
      best = cand;
      aiApproved = true;
      aiNote = gate.note;
      aiReport = gate.report;
      model = gate.model;
      if (gate.report) cand.report = gate.report;
      cand.confidence = Math.max(cand.confidence, gate.confidence);
      break;
    }
    refusals.push(
      `${cand.coin} ${cand.order.side}: ${gate.note}`.slice(0, 120),
    );
    aiNote = gate.note;
    aiReport = gate.report;
    model = gate.model;
  }

  if (!aiApproved && candidates.length) {
    aiNote = `Aucun candidat validé (${gatedTried}) — ${refusals.slice(0, 3).join(" · ")}`;
  } else if (!candidates.length && best) {
    aiNote = best.cancelReason || "Setup SMC non actionnable";
  }

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
  };
  scanCache = { key: cacheKey, at: Date.now(), value };
  return value;
}
