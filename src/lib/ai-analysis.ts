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
      bullets.push("MACD au-dessus de sa signal (histogramme > 0) : biais haussier court terme.");
    } else if (ind.macdHist < 0 && ind.macd < ind.macdSignal) {
      score -= 2;
      bullets.push("MACD sous sa signal (histogramme < 0) : biais baissier court terme.");
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
      bullets.push("Prix au-dessus de l’EMA200 : tendance long terme encore haussière.");
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
      bullets.push("Prix sur la bande de Bollinger basse : compression / rebond possible.");
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

export async function maybeAiBtcCommentary(input: {
  indicators: IndicatorSnapshot;
  bias: SignalBias;
  bullets: string[];
}): Promise<{ provider: string | null; text: string | null; error: string | null }> {
  const openai = process.env.OPENAI_API_KEY?.trim();
  const anthropic = process.env.ANTHROPIC_API_KEY?.trim();
  const prompt = `Tu es un analyste crypto prudent. Donne une analyse BTC moyen terme (quelques jours à 2 semaines) en français, 4-7 phrases max.
Ce n'est PAS un conseil financier. Base-toi uniquement sur ces indicateurs:
${JSON.stringify(input.indicators, null, 2)}
Biais règles: ${input.bias}
Points: ${input.bullets.join(" | ")}
Structure: 1) contexte 2) signaux techniques 3) scénarios haussier/baissier 4) niveaux à surveiller 5) rappel risque.`;

  if (openai) {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openai}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
          temperature: 0.3,
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
        return {
          provider: "openai",
          text: null,
          error: json.error?.message || `OpenAI HTTP ${res.status}`,
        };
      }
      return {
        provider: "openai",
        text: json.choices?.[0]?.message?.content?.trim() || null,
        error: null,
      };
    } catch (error) {
      return {
        provider: "openai",
        text: null,
        error: error instanceof Error ? error.message : "Erreur OpenAI",
      };
    }
  }

  if (anthropic) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": anthropic,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL?.trim() || "claude-3-5-haiku-latest",
          max_tokens: 700,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const json = (await res.json()) as {
        content?: { type: string; text?: string }[];
        error?: { message?: string };
      };
      if (!res.ok) {
        return {
          provider: "anthropic",
          text: null,
          error: json.error?.message || `Anthropic HTTP ${res.status}`,
        };
      }
      const text = json.content?.find((c) => c.type === "text")?.text?.trim() || null;
      return { provider: "anthropic", text, error: null };
    } catch (error) {
      return {
        provider: "anthropic",
        text: null,
        error: error instanceof Error ? error.message : "Erreur Anthropic",
      };
    }
  }

  return {
    provider: null,
    text: null,
    error:
      "Ajoute OPENAI_API_KEY ou ANTHROPIC_API_KEY dans .env.local pour activer l’avis IA.",
  };
}
