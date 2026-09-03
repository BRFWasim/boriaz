export interface MacroEvent {
  id: string;
  title: string;
  country: string;
  at: string;
  impact: "High" | "Medium" | "Low" | "Holiday" | string;
  forecast: string;
  previous: string;
  actual: string;
  status: "urgent" | "upcoming" | "done";
  prediction: string;
  marketEffect: string;
}

export interface MacroPayload {
  events: MacroEvent[];
  weekLabel: string;
  urgent: MacroEvent[];
  upcoming: MacroEvent[];
  fetchedAt: number;
  source: string;
  disclaimer: string;
}

function effectFor(title: string, country: string): { prediction: string; marketEffect: string } {
  const t = title.toLowerCase();
  const usd = country === "USD";
  if (t.includes("cpi") || t.includes("inflation") || t.includes("pce")) {
    return {
      prediction: usd
        ? "Surprise ↑ inflation → \$ plus fort, crypto souvent sous pression. Surprise ↓ → l’inverse."
        : "Surprise inflation locale → impact FX regional, crypto secondaire.",
      marketEffect: "Volatilité BTC/ETH autour de la release ; funding et perps sensibles.",
    };
  }
  if (t.includes("fomc") || t.includes("interest rate") || t.includes("fed")) {
    return {
      prediction:
        "Hawkish / rate hold ferme → risque risk-off. Dovish / cut → souvent favorable aux actifs risque.",
      marketEffect: "Move directionnel possible sur BTC + alts majeures dans les heures suivantes.",
    };
  }
  if (t.includes("non-farm") || t.includes("nfp") || t.includes("unemployment")) {
    return {
      prediction:
        "NFP fort → Fed plus restrictive (\$↑, crypto mitigé). NFP faible → risque d’assouplissement.",
      marketEffect: "Pic de vol court terme ; éviter le levier élevé juste avant.",
    };
  }
  if (t.includes("gdp") || t.includes("pmi") || t.includes("ism")) {
    return {
      prediction: "Croissance > consensus → risk-on possible. < consensus → prudence.",
      marketEffect: "Impact modéré à fort selon surprise vs forecast.",
    };
  }
  if (t.includes("ecb") || t.includes("boe") || t.includes("boj")) {
    return {
      prediction: "Décision banque centrale hors US → FX d’abord, crypto en second ordre.",
      marketEffect: "Corrélation parfois via DXY / liquidité globale.",
    };
  }
  return {
    prediction: "Surveiller l’écart actual vs forecast : plus l’écart est grand, plus le move est probable.",
    marketEffect: "Ajuster le risque / levier avant les événements High impact.",
  };
}

function statusOf(iso: string, now: number): MacroEvent["status"] {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "upcoming";
  if (t < now - 2 * 3600_000) return "done";
  if (t <= now + 6 * 3600_000) return "urgent";
  return "upcoming";
}

export async function getMacroCalendar(): Promise<MacroPayload> {
  const now = Date.now();
  let raw: {
    title?: string;
    country?: string;
    date?: string;
    impact?: string;
    forecast?: string;
    previous?: string;
    actual?: string;
  }[] = [];

  try {
    const res = await fetch(
      "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
      { cache: "no-store" },
    );
    if (res.ok) {
      raw = (await res.json()) as typeof raw;
    }
  } catch {
    raw = [];
  }

  const events: MacroEvent[] = raw
    .filter((e) => e.title && e.date)
    .map((e, i) => {
      const country = e.country || "";
      const title = e.title || "";
      const { prediction, marketEffect } = effectFor(title, country);
      const at = e.date!;
      return {
        id: `${at}-${title}-${i}`,
        title,
        country,
        at,
        impact: e.impact || "Low",
        forecast: e.forecast || "",
        previous: e.previous || "",
        actual: e.actual || "",
        status: statusOf(at, now),
        prediction,
        marketEffect,
      };
    })
    .filter((e) => ["USD", "EUR", "GBP", "JPY", "CNY", "All"].includes(e.country))
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  const high = events.filter((e) => e.impact === "High");
  const urgent = high.filter((e) => e.status === "urgent" || e.status === "upcoming").slice(0, 12);
  const upcoming = events
    .filter((e) => e.status === "upcoming" && (e.impact === "High" || e.impact === "Medium"))
    .slice(0, 24);

  return {
    events,
    weekLabel: "Cette semaine (calendrier macro live)",
    urgent,
    upcoming,
    fetchedAt: now,
    source: "Fair Economy / Forex Factory public feed",
    disclaimer:
      "Prédictions = scénarios éducatifs, pas des certitudes. Vérifie toujours l’heure officielle.",
  };
}
