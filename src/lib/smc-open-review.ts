/**
 * Relecture SMC pendant un trade ouvert (paper ou live) :
 * Sweep / CHoCH+BOS / FVG / ÔTE dans le sens de la position ET à l’encontre.
 */

import { loadCandles } from "./market-analysis";
import {
  analyzeSmcSetup,
  computeOte,
  detectChochBos,
  detectFvg,
  detectLiquiditySweep,
  type SmcSide,
} from "./smc";

export type OpenTradeSmcSnapshot = {
  mtf: string;
  marketSide: SmcSide | null;
  withPosition: {
    sweep: boolean;
    chochBos: boolean;
    fvg: boolean;
    ote: boolean;
    fvgLabel: string | null;
    oteLabel: string | null;
  };
  againstPosition: {
    sweep: boolean;
    chochBos: boolean;
    fvg: boolean;
  };
  against: boolean;
  bullets: string[];
};

function mark(ok: boolean): string {
  return ok ? "✓" : "✗";
}

function fvgLabel(
  fvg: { low: number; high: number; direction: string } | null,
): string | null {
  if (!fvg) return null;
  return `FVG ${fvg.direction} ${fvg.low}–${fvg.high}`;
}

function oteLabel(
  ote: { low: number; high: number; ideal: number } | null,
): string | null {
  if (!ote) return null;
  return `ÔTE ${ote.low}–${ote.high} (idéal ${ote.ideal})`;
}

/** Analyse SMC live pour une position ouverte (long ou short). */
export async function reviewOpenTradeSmc(opts: {
  coin: string;
  side: SmcSide;
  price: number;
  walletEur?: number;
}): Promise<OpenTradeSmcSnapshot | null> {
  try {
    const [d1, h4, h1, m15] = await Promise.all([
      loadCandles(opts.coin, "1d"),
      loadCandles(opts.coin, "4h"),
      loadCandles(opts.coin, "1h"),
      loadCandles(opts.coin, "15m"),
    ]);
    if (!m15.length || !h1.length) return null;

    const setup = analyzeSmcSetup({
      coin: opts.coin,
      price: opts.price,
      candlesD1: d1,
      candlesH4: h4,
      candlesH1: h1,
      candlesExec: m15,
      walletEur: opts.walletEur ?? 1000,
      maxLeverage: 3,
    });

    const opp: SmcSide = opts.side === "long" ? "short" : "long";

    const withSweep = detectLiquiditySweep(m15, opts.side);
    const withBos = detectChochBos(m15, opts.side);
    const withFvg = detectFvg(m15, opts.side);
    let withOte = null as ReturnType<typeof computeOte> | null;
    if (withBos.impulseHigh > withBos.impulseLow) {
      withOte = computeOte(opts.side, withBos.impulseHigh, withBos.impulseLow);
    } else if (withSweep.ok) {
      const win = m15.slice(-20);
      const hi = Math.max(...win.map((c) => c.h));
      const lo = Math.min(...win.map((c) => c.l));
      if (hi > lo) withOte = computeOte(opts.side, hi, lo);
    }

    const againstSweep = detectLiquiditySweep(m15, opp);
    const againstBos = detectChochBos(m15, opp);
    const againstFvg = detectFvg(m15, opp);

    const marketSide = setup.side;
    const against =
      (marketSide != null && marketSide !== opts.side) ||
      (againstBos.ok && againstSweep.ok);

    const withPos = {
      sweep: withSweep.ok,
      chochBos: withBos.ok,
      fvg: Boolean(withFvg),
      ote: Boolean(withOte),
      fvgLabel: fvgLabel(withFvg),
      oteLabel: oteLabel(withOte),
    };
    const againstPos = {
      sweep: againstSweep.ok,
      chochBos: againstBos.ok,
      fvg: Boolean(againstFvg),
    };

    const bullets: string[] = [
      `SMC MTF D1/H4/H1 : ${setup.bias.d1}/${setup.bias.h4}/${setup.bias.h1}${
        marketSide ? ` · biais marché ${marketSide.toUpperCase()}` : " · MTF neutre"
      }`,
      `Dans le sens ${opts.side.toUpperCase()} : Sweep ${mark(withPos.sweep)} · CHoCH+BOS ${mark(withPos.chochBos)} · FVG ${mark(withPos.fvg)} · ÔTE ${mark(withPos.ote)}`,
    ];
    if (withPos.fvgLabel) bullets.push(withPos.fvgLabel);
    if (withPos.oteLabel) bullets.push(withPos.oteLabel);
    if (withSweep.level != null) {
      bullets.push(`Liquidity ${opts.side} @ ${withSweep.level}`);
    }
    bullets.push(
      `Contre ${opts.side.toUpperCase()} (${opp}) : Sweep ${mark(againstPos.sweep)} · CHoCH+BOS ${mark(againstPos.chochBos)} · FVG ${mark(againstPos.fvg)}`,
    );
    if (againstFvg) bullets.push(fvgLabel(againstFvg)!);
    bullets.push(
      against
        ? `Structure SMC CONTRE le ${opts.side} — viabilité faible / sortie à surveiller`
        : withPos.chochBos || withPos.sweep
          ? `Structure SMC encore AVEC le ${opts.side} — setup vivant`
          : `Structure SMC soft sur le ${opts.side} — attendre confirmation`,
    );

    return {
      mtf: `${setup.bias.d1}/${setup.bias.h4}/${setup.bias.h1}`,
      marketSide,
      withPosition: withPos,
      againstPosition: againstPos,
      against,
      bullets: bullets.slice(0, 8),
    };
  } catch {
    return null;
  }
}
