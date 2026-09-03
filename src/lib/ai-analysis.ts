import type { IndicatorSnapshot, SignalBias } from "./types";

export function ruleBasedBtcView(ind: IndicatorSnapshot): {
  bias: SignalBias;
  score: number;
  summary: string;
  bullets: string[];
} {
  let score = 0;
  const bullets: string[] = [];

  if (ind.rsi14 !== null) {
    if (ind.rsi14 >= 70) {
      score -= 2;
      bullets.push(`RSI14 à ${ind.rsi14.toFixed(1)} : zone de surachat.`);
    } else if (ind.rsi14 <= 30) {
      score += 2;
      bullets.push(`RSI14 à ${ind.rsi14.toFixed(1)} : zone de survente.`);
    } else if (ind.rsi14 >= 55) {
      score += 1;
      bullets.push(`RSI14 à ${ind.rsi14.toFixed(1)} : momentum plutôt positif.`);
    } else if (ind.rsi14 <= 45) {
      score -= 1;
      bullets.push(`RSI14 à ${ind.rsi14.toFixed(1)} : momentum plutôt négatif.`);
    } else {
      bullets.push(`RSI14 à ${ind.rsi14.toFixed(1)} : zone neutre.`);
    }
  }

  if (ind.macd !== null && ind.macdSignal !== null && ind.macdHist !== null) {
    if (ind.macdHist > 0 && ind.macd > ind.macdSignal) {
      score += 2;
      bullets.push(
        "MACD au-dessus de sa signal (histogramme > 0) : biais haussier court terme.",
      );
    } else if (ind.macdHist < 0 && ind.macd < ind.macdSignal) {
      score -= 2;
      bullets.push(
        "MACD sous sa signal (histogramme < 0) : biais baissier court terme.",
      );
    } else {
      bullets.push("MACD mixte / en transition.");
    }
  }

  if (ind.ema20 !== null && ind.ema50 !== null && ind.price > 0) {
    if (ind.price > ind.ema20 && ind.ema20 > ind.ema50) {
      score += 2;
      bullets.push("Prix > EMA20 > EMA50 : structure haussière moyen terme.");
    } else if (ind.price < ind.ema20 && ind.ema20 < ind.ema50) {
      score -= 2;
      bullets.push("Prix < EMA20 < EMA50 : structure baissière moyen terme.");
    } else {
      bullets.push("EMAs enchevêtrées : marché sans tendance claire.");
    }
  }

  if (ind.ema200 !== null) {
    if (ind.price > ind.ema200) {
      score += 1;
      bullets.push(
        "Prix au-dessus de l’EMA200 : tendance long terme encore haussière.",
      );
    } else {
      score -= 1;
      bullets.push("Prix sous l’EMA200 : tendance long terme sous pression.");
    }
  }

  if (ind.bbUpper !== null && ind.bbLower !== null && ind.bbMiddle !== null) {
    if (ind.price >= ind.bbUpper) {
      score -= 1;
      bullets.push("Prix sur la bande de Bollinger haute : extension possible.");
    } else if (ind.price <= ind.bbLower) {
      score += 1;
      bullets.push(
        "Prix sur la bande de Bollinger basse : compression / rebond possible.",
      );
    }
  }

  if (ind.change24hPct !== null) {
    bullets.push(`Variation 24h : ${ind.change24hPct.toFixed(2)} %.`);
  }
  if (ind.support !== null && ind.resistance !== null) {
    bullets.push(
      `Supports / résistances locaux (fenêtre) : ${ind.support.toFixed(0)} / ${ind.resistance.toFixed(0)}.`,
    );
  }

  const bias: SignalBias =
    score >= 3 ? "haussier" : score <= -3 ? "baissier" : "neutre";
  const summary =
    bias === "haussier"
      ? "Lecture technique moyen terme plutôt haussière (règles RSI/MACD/EMA)."
      : bias === "baissier"
        ? "Lecture technique moyen terme plutôt baissière (règles RSI/MACD/EMA)."
        : "Lecture technique moyen terme neutre / indécise.";

  return { bias, score, summary, bullets };
}

export interface DualAiResult {
  enabled: boolean;
  openai: { text: string | null; error: string | null };
  anthropic: { text: string | null; error: string | null };
  consensus: string | null;
  providers: string[];
}

function buildPrompt(input: {
  indicators: IndicatorSnapshot;
  bias: SignalBias;
  bullets: string[];
  external?: Record<string, unknown>;
  role: "openai" | "anthropic";
}): string {
  const angle =
    input.role === "openai"
      ? "Insiste sur le plan d'action clair (zones d'achat/invalidations) et le timing moyen terme."
      : "Insiste sur les risques, les faux signaux et les scénarios alternatifs.";
  return `Tu es un analyste crypto prudent. Analyse BTC en français (moyen terme: jours → ~2 semaines).
Ce n'est PAS un conseil financier. ${angle}

Indicateurs:
${JSON.stringify(input.indicators, null, 2)}

Contexte externe:
${JSON.stringify(input.external ?? {}, null, 2)}

Biais règles locales: ${input.bias}
Points techniques: ${input.bullets.join(" | ")}

Structure obligatoire:
1) Contexte prix / tendance
2) Lecture RSI + MACD + EMAs + Bollinger
3) Scénario haussier (niveaux)
4) Scénario baissier (niveaux)
5) Meilleure zone d'achat éventuelle OU pourquoi patienter
6) Invalidation
7) Rappel risque
Max ~10 phrases, style net et concret.`;
}

async function askOpenAi(prompt: string): Promise<{ text: string | null; error: string | null }> {
  const openai = process.env.OPENAI_API_KEY?.trim();
  if (!openai) return { text: null, error: "OPENAI_API_KEY manquante" };
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openai}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
        temperature: 0.25,
        messages: [
          {
            role: "system",
            content:
              "Analyste crypto factuel. Pas de promesse de gain. Français clair.",
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
      return { text: null, error: json.error?.message || `OpenAI HTTP ${res.status}` };
    }
    return {
      text: json.choices?.[0]?.message?.content?.trim() || null,
      error: null,
    };
  } catch (error) {
    return {
      text: null,
      error: error instanceof Error ? error.message : "Erreur OpenAI",
    };
  }
}

async function askAnthropic(prompt: string): Promise<{ text: string | null; error: string | null }> {
  const anthropic = process.env.ANTHROPIC_API_KEY?.trim();
  if (!anthropic) return { text: null, error: "ANTHROPIC_API_KEY manquante" };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropic,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model:
          process.env.ANTHROPIC_MODEL?.trim() || "claude-haiku-4-5-20251001",
        max_tokens: 900,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const json = (await res.json()) as {
      content?: { type: string; text?: string }[];
      error?: { message?: string };
    };
    if (!res.ok) {
      return {
        text: null,
        error: json.error?.message || `Anthropic HTTP ${res.status}`,
      };
    }
    const text =
      json.content?.find((c) => c.type === "text")?.text?.trim() || null;
    return { text, error: null };
  } catch (error) {
    return {
      text: null,
      error: error instanceof Error ? error.message : "Erreur Anthropic",
    };
  }
}

export async function dualAiBtcCommentary(input: {
  indicators: IndicatorSnapshot;
  bias: SignalBias;
  bullets: string[];
  external?: Record<string, unknown>;
}): Promise<DualAiResult> {
  const [openai, anthropic] = await Promise.all([
    askOpenAi(
      buildPrompt({
        ...input,
        role: "openai",
      }),
    ),
    askAnthropic(
      buildPrompt({
        ...input,
        role: "anthropic",
      }),
    ),
  ]);

  const providers: string[] = [];
  if (openai.text) providers.push("chatgpt");
  if (anthropic.text) providers.push("claude");

  let consensus: string | null = null;
  if (openai.text && anthropic.text) {
    consensus = [
      "Synthèse croisée ChatGPT + Claude",
      "Les deux modèles ont produit une lecture. Compare zones d’achat, invalidations et risques avant toute décision.",
      "Ce n’est pas un conseil financier.",
    ].join("\n");
  } else if (openai.text || anthropic.text) {
    consensus = "Une seule IA a répondu ; la seconde est indisponible ou en erreur.";
  }

  return {
    enabled: providers.length > 0,
    openai,
    anthropic,
    consensus,
    providers,
  };
}
