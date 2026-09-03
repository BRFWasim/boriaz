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
  if (ind.change7dPct !== null) {
    bullets.push(`Variation 7j : ${ind.change7dPct.toFixed(2)} %.`);
    if (ind.change7dPct >= 8) score += 2;
    else if (ind.change7dPct <= -8) score -= 2;
  }
  if (ind.change30dPct !== null) {
    bullets.push(`Variation 30j : ${ind.change30dPct.toFixed(2)} %.`);
    if (ind.change30dPct >= 15) score += 1;
    else if (ind.change30dPct <= -15) score -= 1;
  }
  if (ind.stochK !== null && ind.stochD !== null) {
    if (ind.stochK <= 20) {
      score += 1;
      bullets.push(
        `Stochastique %K ${ind.stochK.toFixed(0)} : zone basse.`,
      );
    } else if (ind.stochK >= 80) {
      score -= 1;
      bullets.push(
        `Stochastique %K ${ind.stochK.toFixed(0)} : zone haute.`,
      );
    } else {
      bullets.push(
        `Stochastique %K/%D : ${ind.stochK.toFixed(0)} / ${ind.stochD.toFixed(0)}.`,
      );
    }
  }
  if (ind.adx14 !== null) {
    bullets.push(
      ind.adx14 >= 25
        ? `ADX ${ind.adx14.toFixed(0)} : tendance marquée.`
        : `ADX ${ind.adx14.toFixed(0)} : marché peu directionnel.`,
    );
  }
  if (ind.roc12 !== null) {
    bullets.push(`ROC12 : ${ind.roc12.toFixed(2)} %.`);
  }
  if (ind.volumeRatio !== null) {
    bullets.push(
      `Volume vs moyenne : ×${ind.volumeRatio.toFixed(2)}.`,
    );
  }
  if (ind.support !== null && ind.resistance !== null) {
    bullets.push(
      `Supports / résistances locaux : ${smartPx(ind.support)} / ${smartPx(ind.resistance)}.`,
    );
  }

  const bias: SignalBias =
    score >= 3 ? "haussier" : score <= -3 ? "baissier" : "neutre";
  const summary =
    bias === "haussier"
      ? "Lecture technique plutôt haussière (règles RSI/MACD/EMA)."
      : bias === "baissier"
        ? "Lecture technique plutôt baissière (règles RSI/MACD/EMA)."
        : "Lecture technique neutre / indécise.";

  return { bias, score, summary, bullets };
}

function smartPx(px: number): string {
  if (px >= 1000) return px.toFixed(0);
  if (px >= 10) return px.toFixed(2);
  if (px >= 1) return px.toFixed(3);
  return px.toFixed(5);
}

export interface DualAiResult {
  enabled: boolean;
  openai: { text: string | null; error: string | null };
  anthropic: { text: string | null; error: string | null };
  consensus: string | null;
  providers: string[];
  cached?: boolean;
  skipped?: boolean;
}

/** Cache mémoire ~45 min — évite de re-payer des tokens à chaque refresh UI. */
const AI_CACHE_TTL_MS = 45 * 60_000;
let aiCache: { key: string; at: number; value: DualAiResult } | null = null;

function compactInd(ind: IndicatorSnapshot): Record<string, number | null> {
  return {
    px: round(ind.price, 2),
    ch24: round(ind.change24hPct, 2),
    rsi: round(ind.rsi14, 1),
    macd: round(ind.macd, 2),
    sig: round(ind.macdSignal, 2),
    hist: round(ind.macdHist, 2),
    e20: round(ind.ema20, 2),
    e50: round(ind.ema50, 2),
    e200: round(ind.ema200, 2),
    atr: round(ind.atr14, 2),
    bbL: round(ind.bbLower, 2),
    bbU: round(ind.bbUpper, 2),
    sup: round(ind.support, 2),
    res: round(ind.resistance, 2),
  };
}

function round(v: number | null, d: number): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

function buildCompactPrompt(input: {
  symbol: string;
  indicators: IndicatorSnapshot;
  bias: SignalBias;
  bullets: string[];
  solHint?: string;
  role: "openai" | "anthropic";
}): string {
  const angle =
    input.role === "openai"
      ? "Plan d'action + zone d'achat/invalidation."
      : "Risques, faux signaux, scénario alternatif.";
  return `Analyste crypto prudent. FR. PAS un conseil financier. ${angle}
Actif principal: ${input.symbol}. Horizon: jours→~2 semaines + note long terme.
Ind: ${JSON.stringify(compactInd(input.indicators))}
Biais règles: ${input.bias}
Tech: ${input.bullets.slice(0, 6).join(" | ")}
${input.solHint ? `SOL: ${input.solHint}` : ""}
Réponds en ≤8 phrases courtes: tendance, RSI/MACD/EMA, zone achat, invalidation, risque.`;
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
        temperature: 0.2,
        max_tokens: 420,
        messages: [
          {
            role: "system",
            content: "Analyste crypto factuel. Pas de promesse de gain. FR court.",
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
        max_tokens: 420,
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

function cacheKey(input: {
  symbol: string;
  indicators: IndicatorSnapshot;
  bias: SignalBias;
}): string {
  const px = Math.round(input.indicators.price);
  const rsi = Math.round(input.indicators.rsi14 ?? 0);
  return `${input.symbol}:${px}:${rsi}:${input.bias}`;
}

/**
 * Dual IA BTC (+ note SOL optionnelle).
 * Cache 45 min. Passer includeAi=false pour 0 token (refresh silencieux / digests).
 */
export async function dualAiBtcCommentary(input: {
  indicators: IndicatorSnapshot;
  bias: SignalBias;
  bullets: string[];
  external?: Record<string, unknown>;
  solHint?: string;
  includeAi?: boolean;
  symbol?: string;
}): Promise<DualAiResult> {
  if (input.includeAi === false) {
    return {
      enabled: false,
      openai: { text: null, error: null },
      anthropic: { text: null, error: null },
      consensus: null,
      providers: [],
      skipped: true,
    };
  }

  const symbol = input.symbol ?? "BTC";
  const key = cacheKey({ symbol, indicators: input.indicators, bias: input.bias });
  if (aiCache && aiCache.key === key && Date.now() - aiCache.at < AI_CACHE_TTL_MS) {
    return { ...aiCache.value, cached: true };
  }

  const [openai, anthropic] = await Promise.all([
    askOpenAi(
      buildCompactPrompt({
        symbol,
        indicators: input.indicators,
        bias: input.bias,
        bullets: input.bullets,
        solHint: input.solHint,
        role: "openai",
      }),
    ),
    askAnthropic(
      buildCompactPrompt({
        symbol,
        indicators: input.indicators,
        bias: input.bias,
        bullets: input.bullets,
        solHint: input.solHint,
        role: "anthropic",
      }),
    ),
  ]);

  const providers: string[] = [];
  if (openai.text) providers.push("chatgpt");
  if (anthropic.text) providers.push("claude");

  let consensus: string | null = null;
  if (openai.text && anthropic.text) {
    consensus =
      "Synthèse croisée ChatGPT + Claude (cache 45 min). Compare zones / invalidations. Pas un conseil financier.";
  } else if (openai.text || anthropic.text) {
    consensus = "Une seule IA a répondu ; la seconde est indisponible.";
  }

  const value: DualAiResult = {
    enabled: providers.length > 0,
    openai,
    anthropic,
    consensus,
    providers,
    cached: false,
  };
  aiCache = { key, at: Date.now(), value };
  return value;
}

export interface AssetAiBrief {
  coin: string;
  text: string;
}

export interface WatchlistAiResult {
  enabled: boolean;
  cached: boolean;
  skipped: boolean;
  error: string | null;
  briefs: AssetAiBrief[];
  provider: string | null;
}

let watchAiCacheLive: {
  key: string;
  at: number;
  value: WatchlistAiResult;
} | null = null;

/**
 * Une seule requête Haiku pour toute la watchlist (beaucoup moins cher que 8× dual IA).
 */
export async function batchWatchlistAi(input: {
  assets: {
    coin: string;
    bias: SignalBias;
    score: number;
    buyZone: string;
    indicators: IndicatorSnapshot;
    tf?: { interval: string; bias: SignalBias; score: number }[];
  }[];
  includeAi?: boolean;
}): Promise<WatchlistAiResult> {
  if (input.includeAi === false) {
    return {
      enabled: false,
      cached: false,
      skipped: true,
      error: null,
      briefs: [],
      provider: null,
    };
  }

  const key = input.assets
    .map(
      (a) =>
        `${a.coin}:${Math.round(a.indicators.price * 100)}:${a.bias}:${a.score}`,
    )
    .join("|");
  if (
    watchAiCacheLive &&
    watchAiCacheLive.key === key &&
    Date.now() - watchAiCacheLive.at < AI_CACHE_TTL_MS
  ) {
    return { ...watchAiCacheLive.value, cached: true };
  }

  const compact = input.assets.map((a) => ({
    coin: a.coin,
    bias: a.bias,
    score: a.score,
    zone: a.buyZone,
    tf: a.tf ?? [],
    ch7d: round(a.indicators.change7dPct, 2),
    ch30d: round(a.indicators.change30dPct, 2),
    ind: {
      ...compactInd(a.indicators),
      stochK: round(a.indicators.stochK, 1),
      adx: round(a.indicators.adx14, 1),
      roc: round(a.indicators.roc12, 2),
    },
  }));

  const coins = input.assets.map((a) => a.coin).join(", ");
  const prompt = `Analyste crypto PRUDENT. FR. PAS un conseil financier.
Tu DOIS traiter TOUS ces coins, aucun oubli : ${coins}.
Pour CHAQUE coin : 4–6 phrases. Croise 1h + 4h + 1d + 1w. Si 1d/1w haussiers, NE DIS PAS d’attendre juste parce que le 1h pause — note le trend long terme et le scénario de breakout.
Format OBLIGATOIRE, un bloc par coin :
=== BTC ===
texte
=== ETH ===
texte
Données: ${JSON.stringify(compact)}`;

  let text: string | null = null;
  let provider: string | null = null;
  let error: string | null = null;

  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (anthropicKey) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model:
            process.env.ANTHROPIC_MODEL?.trim() || "claude-haiku-4-5-20251001",
          max_tokens: 2800,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const json = (await res.json()) as {
        content?: { type: string; text?: string }[];
        error?: { message?: string };
      };
      if (res.ok) {
        text =
          json.content?.find((c) => c.type === "text")?.text?.trim() || null;
        provider = "claude";
      } else {
        error = json.error?.message || `Anthropic HTTP ${res.status}`;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : "Erreur Anthropic";
    }
  }

  if (!text) {
    const openaiKey = process.env.OPENAI_API_KEY?.trim();
    if (openaiKey) {
      try {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${openaiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
            temperature: 0.2,
            max_tokens: 2800,
            messages: [
              {
                role: "system",
                content:
                  "Analyste crypto. Pour chaque coin: === COIN === puis 3-5 phrases. FR.",
              },
              { role: "user", content: prompt },
            ],
          }),
        });
        const json = (await res.json()) as {
          choices?: { message?: { content?: string } }[];
          error?: { message?: string };
        };
        if (res.ok) {
          text = json.choices?.[0]?.message?.content?.trim() || null;
          provider = "chatgpt";
          error = null;
        } else if (!error) {
          error = json.error?.message || `OpenAI HTTP ${res.status}`;
        }
      } catch (e) {
        if (!error) error = e instanceof Error ? e.message : "Erreur OpenAI";
      }
    } else if (!error) {
      error = "IA indisponible";
    }
  }

  const briefs: AssetAiBrief[] = [];
  if (text) {
    const parts = text.split(/===\s*([A-Z0-9]+)\s*===/i);
    if (parts.length >= 3) {
      for (let i = 1; i < parts.length; i += 2) {
        const coin = parts[i]!.toUpperCase();
        const body = parts[i + 1]?.trim();
        if (body) briefs.push({ coin, text: body });
      }
    }
    // Fallback: titres markdown / "RENDER :"
    if (briefs.length < input.assets.length) {
      for (const a of input.assets) {
        if (briefs.some((b) => b.coin === a.coin)) continue;
        const re = new RegExp(
          `(?:^|\\n)\\s*(?:#+\\s*)?(?:\\*\\*)?${a.coin}(?:\\*\\*)?\\s*[:\\-–]\\s*([\\s\\S]*?)(?=\\n\\s*(?:#+\\s*)?(?:\\*\\*)?(?:${input.assets.map((x) => x.coin).join("|")})(?:\\*\\*)?\\s*[:\\-–]|$)`,
          "i",
        );
        const m = re.exec(text);
        if (m?.[1]?.trim()) {
          briefs.push({ coin: a.coin, text: m[1].trim() });
        }
      }
    }
    if (!briefs.length) {
      briefs.push({ coin: "ALL", text });
    }
  }

  // Complète les coins manqués par une mini-requête (max 4)
  const missing = input.assets.filter(
    (a) => !briefs.some((b) => b.coin === a.coin),
  );
  for (const a of missing.slice(0, 4)) {
    const onePrompt = `Analyste crypto FR. PAS un conseil. ${a.coin} : 4 phrases croisant 1h/4h/1d/1w, 7j=${round(a.indicators.change7dPct, 1)}% 30j=${round(a.indicators.change30dPct, 1)}%. Biais ${a.bias} score ${a.score}. TF ${JSON.stringify(a.tf ?? [])}. Zone ${a.buyZone}.`;
    const one = await askOpenAi(onePrompt);
    if (one.text) briefs.push({ coin: a.coin, text: one.text });
    else {
      const cl = await askAnthropic(onePrompt);
      if (cl.text) briefs.push({ coin: a.coin, text: cl.text });
    }
  }

  const value: WatchlistAiResult = {
    enabled: briefs.length > 0,
    cached: false,
    skipped: false,
    error,
    briefs,
    provider,
  };
  watchAiCacheLive = { key, at: Date.now(), value };
  return value;
}
