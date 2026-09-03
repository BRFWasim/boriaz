import {
  formatPct,
  formatRoi,
  formatUsd,
  formatWinRate,
  riskClass,
  signedClass,
} from "@/lib/format";
import type { MarketOverview } from "@/lib/types";

export function MarketOverviewPanel({ overview }: { overview: MarketOverview }) {
  return (
    <section className="rounded-xl border border-border/80 bg-card/70 p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
            Vue marché · 10 baleines
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Agrégat live des expositions, biais et zones où plusieurs baleines se
            concentrent.
          </p>
        </div>
        <span
          className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
            overview.bias === "long"
              ? "border-long/40 bg-long/10 text-long"
              : overview.bias === "short"
                ? "border-short/40 bg-short/10 text-short"
                : "border-border text-muted-foreground"
          }`}
        >
          Biais net {overview.bias}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-8">
        <Metric label="Equity perps" value={formatUsd(overview.totalEquity)} />
        <Metric
          label="Exposition brute"
          value={formatUsd(overview.totalGrossExposure)}
        />
        <Metric
          label="Longs"
          value={formatUsd(overview.totalLongUsd)}
          className="text-long"
        />
        <Metric
          label="Shorts"
          value={formatUsd(overview.totalShortUsd)}
          className="text-short"
        />
        <Metric
          label="PnL latent"
          value={formatUsd(overview.totalUnrealized)}
          className={signedClass(overview.totalUnrealized)}
        />
        <Metric
          label="PnL 24h"
          value={formatUsd(overview.totalPnl24h)}
          className={signedClass(overview.totalPnl24h)}
        />
        <Metric
          label="Spot total"
          value={formatUsd(overview.totalSpotValueUsd)}
        />
        <Metric
          label="Short+spot"
          value={String(overview.shortWithSpotCount)}
          className={overview.shortWithSpotCount > 0 ? "text-short" : undefined}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="text-xs tracking-wide text-muted-foreground uppercase">
            Cryptos les plus suivies
          </h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-sm">
              <thead className="text-[11px] text-muted-foreground uppercase">
                <tr>
                  <th className="py-1 font-medium">Coin</th>
                  <th className="py-1 font-medium">Baleines</th>
                  <th className="py-1 font-medium">Long</th>
                  <th className="py-1 font-medium">Short</th>
                  <th className="py-1 font-medium">Net</th>
                  <th className="py-1 font-medium">Funding 8h</th>
                </tr>
              </thead>
              <tbody>
                {overview.crowded.map((coin) => (
                  <tr key={coin.coin} className="border-t border-border/50">
                    <td className="py-1.5 font-medium">{coin.coin}</td>
                    <td className="numeric py-1.5">{coin.whaleCount}</td>
                    <td className="numeric py-1.5 text-long">
                      {formatUsd(coin.longUsd)}
                    </td>
                    <td className="numeric py-1.5 text-short">
                      {formatUsd(coin.shortUsd)}
                    </td>
                    <td className={`numeric py-1.5 ${signedClass(coin.netUsd)}`}>
                      {formatUsd(coin.netUsd)}
                    </td>
                    <td className="numeric py-1.5">
                      {coin.fundingRate8h === null
                        ? "n/d"
                        : formatPct(coin.fundingRate8h * 100, 4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3 className="text-xs tracking-wide text-muted-foreground uppercase">
            Profil risque / perf
          </h3>
          <div className="mt-2 space-y-2 text-sm">
            <p>
              Win rate moyen :{" "}
              <span className="numeric font-medium">
                {formatWinRate(overview.avgWinRate, overview.avgWinRate ? 1 : 0)}
              </span>
            </p>
            <p>
              Net biais :{" "}
              <span className={`numeric font-medium ${signedClass(overview.netBiasUsd)}`}>
                {formatUsd(overview.netBiasUsd)}
              </span>
            </p>
            <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
              <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
                Plus risquées (score interne)
              </p>
              <ul className="mt-2 space-y-1.5">
                {overview.riskiest.map((item) => (
                  <li
                    key={item.address}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="truncate">{item.alias}</span>
                    <span className={`numeric ${riskClass(item.riskLabel)}`}>
                      {item.riskScore}/100 · {item.riskLabel}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Score basé sur levier, marge utilisée, proximité de liquidation,
                absence de SL et concentration. Ce n’est pas un conseil.
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              ROI leaderboard jour moyen non agrégé ici — voir chaque carte pour
              ROI jour / semaine / mois ({formatRoi(0)} = 0 %).
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Metric({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="rounded-lg bg-muted/30 px-3 py-2">
      <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p className={`numeric mt-1 text-sm font-medium ${className ?? ""}`}>
        {value}
      </p>
    </div>
  );
}
