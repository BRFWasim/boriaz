/**
 * Biais soft OI / funding / squeeze pour le gate SMC LIVE.
 * N’ouvre pas de trade seul — oriente approve/confiance + note IA.
 */
import { fetchMetaAndCtxs } from "./hyperliquid";
import { parseNum } from "./format";

export type PerpFlowBias = {
  coin: string;
  funding8h: number | null;
  openInterestUsd: number | null;
  /** long = squeeze short possible / short = long crowded */
  bias: "favor_long" | "favor_short" | "neutral" | "caution";
  score: number; // -2 .. +2
  note: string;
};

type CtxRow = {
  funding: number;
  oiUsd: number;
  mark: number;
};

let cache: { at: number; byCoin: Map<string, CtxRow> } | null = null;
const TTL = 45_000;

async function loadCtxMap(): Promise<Map<string, CtxRow>> {
  const now = Date.now();
  if (cache && now - cache.at < TTL) return cache.byCoin;
  const { universe, ctxs } = await fetchMetaAndCtxs();
  const byCoin = new Map<string, CtxRow>();
  for (let i = 0; i < universe.length; i++) {
    const name = universe[i]?.name?.toUpperCase();
    const ctx = ctxs[i];
    if (!name || !ctx) continue;
    const mark = parseNum(ctx.markPx || ctx.midPx || "0");
    const oiContracts = parseNum(ctx.openInterest || "0");
    byCoin.set(name, {
      funding: parseNum(ctx.funding || "0"),
      oiUsd: oiContracts * (mark || 0),
      mark,
    });
  }
  cache = { at: now, byCoin };
  return byCoin;
}

/**
 * Heuristique :
 * - funding très négatif → shorts crowded → squeeze up possible (favor long)
 * - funding très positif → longs crowded → dump possible (favor short)
 * - OI élevé + funding extrême = caution (crowded)
 */
export async function getPerpFlowBias(coin: string): Promise<PerpFlowBias> {
  const c = coin.toUpperCase();
  try {
    const map = await loadCtxMap();
    const row = map.get(c);
    if (!row) {
      return {
        coin: c,
        funding8h: null,
        openInterestUsd: null,
        bias: "neutral",
        score: 0,
        note: "OI/funding indisponible",
      };
    }
    const f = row.funding;
    const oi = row.oiUsd;
    let score = 0;
    const bits: string[] = [];
    // funding HL ≈ rate 1h ou 8h selon ctx — traité comme signal direction crowded
    if (f <= -0.0003) {
      score += 1;
      bits.push(`funding ${f.toFixed(5)} (shorts payent → biais long/squeeze)`);
    } else if (f <= -0.00015) {
      score += 0.5;
      bits.push(`funding ${f.toFixed(5)} légèrement négatif`);
    } else if (f >= 0.0003) {
      score -= 1;
      bits.push(`funding ${f.toFixed(5)} (longs crowded → biais short)`);
    } else if (f >= 0.00015) {
      score -= 0.5;
      bits.push(`funding ${f.toFixed(5)} légèrement positif`);
    } else {
      bits.push(`funding ${f.toFixed(5)} neutre`);
    }
    if (oi >= 50_000_000) {
      bits.push(`OI ~${(oi / 1e6).toFixed(1)}M$ (liquide)`);
      if (Math.abs(f) >= 0.00025) {
        score *= 1.25;
        bits.push("OI élevé + funding extrême → squeeze/flush possible");
      }
    } else if (oi > 0 && oi < 5_000_000) {
      score *= 0.75;
      bits.push(`OI bas ~${(oi / 1e6).toFixed(2)}M$ — prudence taille`);
    }
    const bias: PerpFlowBias["bias"] =
      score >= 0.75
        ? "favor_long"
        : score <= -0.75
          ? "favor_short"
          : Math.abs(score) >= 0.4
            ? "caution"
            : "neutral";
    return {
      coin: c,
      funding8h: f,
      openInterestUsd: oi,
      bias,
      score: Math.max(-2, Math.min(2, Math.round(score * 10) / 10)),
      note: bits.join(" · "),
    };
  } catch (e) {
    return {
      coin: c,
      funding8h: null,
      openInterestUsd: null,
      bias: "neutral",
      score: 0,
      note: e instanceof Error ? e.message : "perp-flow err",
    };
  }
}

/** Ajuste conf IA : +/− petits points selon alignement side ↔ flow. */
export function applyFlowToConfidence(
  side: "long" | "short",
  conf: number,
  flow: PerpFlowBias,
): { confidence: number; note: string } {
  let delta = 0;
  if (side === "long" && flow.bias === "favor_long") delta = 3;
  if (side === "short" && flow.bias === "favor_short") delta = 3;
  if (side === "long" && flow.bias === "favor_short") delta = -4;
  if (side === "short" && flow.bias === "favor_long") delta = -4;
  if (flow.bias === "caution" && Math.abs(flow.score) >= 1) delta -= 1;
  const confidence = Math.max(0, Math.min(95, Math.round(conf + delta)));
  return {
    confidence,
    note:
      delta === 0
        ? flow.note
        : `${flow.note} · conf ${delta > 0 ? "+" : ""}${delta}`,
  };
}

/** Soft reject : long contre funding extrême crowded longs, etc. */
export function flowBlocksSide(
  side: "long" | "short",
  flow: PerpFlowBias,
): { block: boolean; why: string } {
  if (side === "long" && flow.funding8h != null && flow.funding8h >= 0.0008) {
    return {
      block: true,
      why: `Funding extrême +${flow.funding8h.toFixed(5)} — longs overcrowded, long LIVE refusé`,
    };
  }
  if (side === "short" && flow.funding8h != null && flow.funding8h <= -0.0008) {
    return {
      block: true,
      why: `Funding extrême ${flow.funding8h.toFixed(5)} — shorts overcrowded (squeeze risk), short LIVE refusé`,
    };
  }
  return { block: false, why: "" };
}
