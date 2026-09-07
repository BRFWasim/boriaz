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
  aiApproved: boolean;
  aiNote: string | null;
  aiReport: string | null;
  model: string;
  fetchedAt: number;
}

type GateResult = {
  approved: boolean;
  confidence: number;
  note: string;
  report: string | null;
  provider: string;
};

function parseGateJson(
  text: string,
  setup: SmcSetup,
  provider: string,
): GateResult {
  const match = text.match(/\{[\s\S]*\}/);
  let approved = false;
  let confidence = 0;
  let note = `Réponse ${provider} illisible`;
  if (match) {
    try {
      const obj = JSON.parse(match[0]) as Record<string, unknown>;
      approved = Boolean(obj.approve);
      confidence = Number(obj.confidence ?? 0);
      note = String(obj.note || "");
      if (approved && confidence < 62) {
        approved = false;
        note = note || `Confiance ${provider} < 62 — bloqué.`;
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
  return `${BORIAZ_SMC_SYSTEM_PROMPT}

Coin: ${setup.coin}
Prix: ${setup.price}
Analyse déterministe déjà calculée (à valider ou corriger) :

${setup.report}

Si TOUTE la checklist 6/6 est VALIDÉE et le statut est ORDRE PRÊT ou EN ATTENTE DE RETRACEMENT, approve=true.
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

  const prompt = smcGatePrompt(setup);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropic,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL?.trim() || CLAUDE_MODEL,
        max_tokens: 1200,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const json = (await res.json()) as {
      content?: { type: string; text?: string }[];
      error?: { message?: string };
    };
    if (!res.ok) {
      return {
        approved: false,
        confidence: 0,
        note: json.error?.message || `Claude HTTP ${res.status}`,
        report: setup.report,
        provider: "claude",
      };
    }
    const text =
      json.content?.find((c) => c.type === "text")?.text?.trim() || "";
    return parseGateJson(text, setup, "Claude");
  } catch (e) {
    return {
      approved: false,
      confidence: 0,
      note: e instanceof Error ? e.message : "Erreur Claude",
      report: setup.report,
      provider: "claude",
    };
  }
  */
}

async function askGptSmcGate(setup: SmcSetup): Promise<GateResult | null> {
  const openai = process.env.OPENAI_API_KEY?.trim();
  if (!openai) return null;

  const prompt = smcGatePrompt(setup);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openai}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL?.trim() || GPT_MODEL_DEFAULT,
        temperature: 0.2,
        max_tokens: 1200,
        messages: [
          {
            role: "system",
            content:
              "Tu valides des setups SMC crypto. Réponds en FR. JSON approve à la fin.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string };
    };
    if (!res.ok) {
      return {
        approved: false,
        confidence: 0,
        note: json.error?.message || `ChatGPT HTTP ${res.status}`,
        report: setup.report,
        provider: "chatgpt",
      };
    }
    const text = json.choices?.[0]?.message?.content?.trim() || "";
    return parseGateJson(text, setup, "ChatGPT");
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
 * Claude Haiku reste commenté / désactivé.
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
  // --- Claude Haiku désactivé (commenté) ---
  // const claude = await askClaudeSmcGate(setup);
  // const gates = [gpt, claude].filter(Boolean) as GateResult[];
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
  const report =
    gates.find((g) => g.report)?.report || setup.report;
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
          if (d1.length < 30 || h4.length < 30 || h1.length < 30 || exec.length < 25) {
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

  const best =
    actionable[0] ??
    setups.sort((a, b) => b.confidence - a.confidence)[0] ??
    null;

  let aiApproved = false;
  let aiNote: string | null = null;
  let aiReport: string | null = null;
  let model = "mechanical-smc";

  if (best && best.checklist.allPass && best.order) {
    const gate = await runSmcAiGates(best);
    aiApproved = gate.approved;
    aiNote = gate.note;
    aiReport = gate.report;
    model = gate.model;
    if (gate.report) best.report = gate.report;
    if (gate.approved) {
      best.confidence = Math.max(best.confidence, gate.confidence);
    }
  } else if (best) {
    aiNote = best.cancelReason || "Setup SMC non actionnable";
  }

  const value: SmcScanResult = {
    setups: setups.sort((a, b) => b.confidence - a.confidence),
    best,
    aiApproved,
    aiNote,
    aiReport,
    model,
    fetchedAt: Date.now(),
  };
  scanCache = { key: cacheKey, at: Date.now(), value };
  return value;
}
