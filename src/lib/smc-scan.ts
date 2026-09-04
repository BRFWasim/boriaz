/**
 * Scan SMC multi-coins + gate Claude Haiku pour le portefeuille Boriaz.
 */
import { loadCandles } from "./market-analysis";
import {
  analyzeSmcSetup,
  BORIAZ_SMC_SYSTEM_PROMPT,
  type SmcSetup,
} from "./smc";
import { WATCHLIST } from "./price-watch";

const CLAUDE_MODEL = "claude-haiku-4-5-20251001";

const SCAN_CACHE_TTL = 4 * 60_000;
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

async function askClaudeSmcGate(
  setup: SmcSetup,
): Promise<{ approved: boolean; confidence: number; note: string; report: string | null }> {
  const anthropic = process.env.ANTHROPIC_API_KEY?.trim();
  if (!anthropic) {
    // Sans clé : on autorise uniquement si checklist 6/6 mécanique
    return {
      approved: setup.checklist.allPass && setup.status !== "ANNULÉ",
      confidence: setup.confidence,
      note: setup.checklist.allPass
        ? "Gate mécanique SMC 6/6 (Claude indisponible)."
        : "Checklist SMC incomplète — bloqué.",
      report: setup.report,
    };
  }

  const prompt = `${BORIAZ_SMC_SYSTEM_PROMPT}

Coin: ${setup.coin}
Prix: ${setup.price}
Analyse déterministe déjà calculée (à valider ou corriger) :

${setup.report}

Si TOUTE la checklist 6/6 est VALIDÉE et le statut est ORDRE PRÊT ou EN ATTENTE DE RETRACEMENT, approve=true.
Sinon approve=false.
Réponds d'abord avec le format [ANALYSE...] complet, puis UNE ligne JSON : {"approve":true|false,"confidence":0-100,"note":"..."}`;

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
      };
    }
    const text =
      json.content?.find((c) => c.type === "text")?.text?.trim() || "";
    const match = text.match(/\{[\s\S]*\}/);
    let approved = false;
    let confidence = 0;
    let note = "Réponse Claude illisible";
    if (match) {
      try {
        const obj = JSON.parse(match[0]) as Record<string, unknown>;
        approved = Boolean(obj.approve);
        confidence = Number(obj.confidence ?? 0);
        note = String(obj.note || "");
        if (approved && confidence < 62) {
          approved = false;
          note = note || "Confiance Claude < 62 — bloqué.";
        }
      } catch {
        approved = false;
      }
    }
    // Exige aussi la checklist mécanique
    if (approved && !setup.checklist.allPass) {
      approved = false;
      note = "Claude OK mais checklist SMC mécanique incomplète.";
    }
    const reportBlock = text.includes("[ANALYSE")
      ? text.replace(/\n?\s*\{[\s\S]*\}\s*$/, "").trim()
      : setup.report;
    return {
      approved,
      confidence,
      note: note || (approved ? "Claude Haiku valide le setup SMC." : "Claude refuse."),
      report: reportBlock || setup.report,
    };
  } catch (e) {
    return {
      approved: false,
      confidence: 0,
      note: e instanceof Error ? e.message : "Erreur Claude",
      report: setup.report,
    };
  }
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

  for (const coin of coins) {
    try {
      const [d1, h4, h1, m15, m30] = await Promise.all([
        loadCandles(coin, "1d"),
        loadCandles(coin, "4h"),
        loadCandles(coin, "1h"),
        loadCandles(coin, "15m"),
        loadCandles(coin, "30m"),
      ]);
      // Exécution : privilégie M15, fallback M30 si trop court
      const exec =
        m15.length >= 40 ? m15 : m30.length >= 30 ? m30 : m15;
      if (d1.length < 30 || h4.length < 30 || h1.length < 30 || exec.length < 25) {
        continue;
      }
      const price =
        input.prices?.[coin] ??
        exec.at(-1)?.c ??
        h1.at(-1)?.c ??
        0;
      if (!(price > 0)) continue;
      const setup = analyzeSmcSetup({
        coin,
        price,
        candlesD1: d1,
        candlesH4: h4,
        candlesH1: h1,
        candlesExec: exec,
        walletEur: input.walletEur,
        maxLeverage: input.maxLeverage ?? 3,
      });
      setups.push(setup);
    } catch {
      // skip coin
    }
  }

  const actionable = setups
    .filter(
      (s) =>
        s.checklist.allPass &&
        (s.status === "ORDRE PRÊT À ÊTRE EXÉCUTÉ" ||
          s.status === "EN ATTENTE DE RETRACEMENT"),
    )
    .sort((a, b) => b.confidence - a.confidence);

  const best = actionable[0] ?? setups.sort((a, b) => b.confidence - a.confidence)[0] ?? null;

  let aiApproved = false;
  let aiNote: string | null = null;
  let aiReport: string | null = null;

  if (best && best.checklist.allPass && best.order) {
    const gate = await askClaudeSmcGate(best);
    aiApproved = gate.approved;
    aiNote = gate.note;
    aiReport = gate.report;
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
    model: process.env.ANTHROPIC_MODEL?.trim() || CLAUDE_MODEL,
    fetchedAt: Date.now(),
  };
  scanCache = { key: cacheKey, at: Date.now(), value };
  return value;
}
