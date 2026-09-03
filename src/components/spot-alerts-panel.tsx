"use client";

import { Badge } from "@/components/ui/badge";
import {
  formatAgo,
  formatExactTime,
  formatPct,
  formatPx,
  formatQty,
  formatUsd,
  signedClass,
} from "@/lib/format";
import type { DashboardPayload, HedgeAlert, Whale } from "@/lib/types";

export function SpotAlertsPanel({ data }: { data: DashboardPayload }) {
  const alerts = data.alerts ?? [];
  const shorts = alerts.filter((a) => a.kind === "short_with_spot");
  const accum = alerts.filter((a) => a.kind === "spot_only_accumulation");

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border/80 bg-card/70 p-4">
        <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          Alertes spot ↔ perps
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Si une baleine est short en perps mais détient le même actif en spot
          (ex. short BTC + UBTC/BTC spot), c’est signalé ici. Les achats spot
          utilisent l’entrée moyenne on-chain (`entryNtl`) et les fills Buy/Sell
          quand ils sont encore dans l’historique public.
        </p>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <Badge variant="outline" className="border-short/40 text-short">
            Short + spot : {shorts.length}
          </Badge>
          <Badge variant="secondary">Accumulations spot : {accum.length}</Badge>
          <Badge variant="outline">
            Spot total ~ {formatUsd(data.overview.totalSpotValueUsd)}
          </Badge>
        </div>
      </section>

      {alerts.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          Aucune alerte short+spot ni accumulation détectée sur le top 10 pour
          le moment.
        </p>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert) => (
            <AlertCard key={alert.id} alert={alert} />
          ))}
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          Portefeuilles spot des baleines
        </h2>
        {data.whales.map((whale) => (
          <WhaleSpotCard key={whale.address} whale={whale} />
        ))}
      </section>
    </div>
  );
}

function AlertCard({ alert }: { alert: HedgeAlert }) {
  const tone =
    alert.severity === "critical"
      ? "border-short/50 bg-short/10"
      : alert.severity === "warn"
        ? "border-amber-500/40 bg-amber-500/10"
        : "border-border bg-muted/30";
  return (
    <article className={`rounded-xl border px-4 py-3 ${tone}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="outline"
          className={
            alert.kind === "short_with_spot"
              ? "border-short/40 text-short"
              : undefined
          }
        >
          {alert.kind === "short_with_spot"
            ? "Short + spot"
            : alert.kind === "long_with_spot"
              ? "Long + spot"
              : "Accumulation"}
        </Badge>
        <h3 className="font-medium">{alert.title}</h3>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{alert.detail}</p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>Actif {alert.baseAsset}</span>
        <span>Spot qty {formatQty(alert.spotQty)}</span>
        <span>
          Entrée moy.{" "}
          {alert.spotAvgPx !== null ? formatPx(alert.spotAvgPx) : "n/d"}
        </span>
        {alert.perpSide ? (
          <span>
            Perps {alert.perpSide} {alert.perpQty ?? ""} @{" "}
            {alert.perpEntryPx !== null ? formatPx(alert.perpEntryPx) : "n/d"}
          </span>
        ) : null}
      </div>
    </article>
  );
}

function WhaleSpotCard({ whale }: { whale: Whale }) {
  if (!whale.spot.length && !whale.spotBuys.length) {
    return (
      <article className="rounded-xl border border-border/70 bg-card/60 px-4 py-3">
        <h3 className="font-medium">
          #{whale.rank} {whale.alias}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Pas de spot significatif (hors USDC) sur ce compte.
        </p>
      </article>
    );
  }

  return (
    <article className="rounded-xl border border-border/70 bg-card/60 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">
          #{whale.rank} {whale.alias}
        </h3>
        <span className="numeric text-sm text-muted-foreground">
          Spot ~ {formatUsd(whale.spotValueUsd)}
        </span>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="text-[11px] text-muted-foreground uppercase">
            <tr>
              <th className="py-1 font-medium">Token</th>
              <th className="py-1 font-medium">Qty</th>
              <th className="py-1 font-medium">Entrée moy.</th>
              <th className="py-1 font-medium">Mark</th>
              <th className="py-1 font-medium">Valeur</th>
              <th className="py-1 font-medium">PnL latent</th>
              <th className="py-1 font-medium">Achats</th>
            </tr>
          </thead>
          <tbody>
            {whale.spot.map((holding) => (
              <tr key={`${whale.address}-${holding.coin}`} className="border-t border-border/50">
                <td className="py-1.5">
                  <div className="font-medium">{holding.coin}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {holding.baseAsset}
                    {holding.alreadyAccumulating ? " · accumule" : ""}
                  </div>
                </td>
                <td className="numeric py-1.5">{formatQty(holding.qty)}</td>
                <td className="numeric py-1.5">
                  {holding.avgEntryPx !== null ? formatPx(holding.avgEntryPx) : "n/d"}
                </td>
                <td className="numeric py-1.5">
                  {holding.markPx !== null ? formatPx(holding.markPx) : "n/d"}
                </td>
                <td className="numeric py-1.5">{formatUsd(holding.valueUsd)}</td>
                <td
                  className={`numeric py-1.5 ${
                    holding.unrealizedPnl === null
                      ? ""
                      : signedClass(holding.unrealizedPnl)
                  }`}
                >
                  {holding.unrealizedPnl === null
                    ? "n/d"
                    : formatUsd(holding.unrealizedPnl)}
                  {holding.moveFromEntryPct !== null ? (
                    <div className="text-[11px] text-muted-foreground">
                      {formatPct(holding.moveFromEntryPct, 2)}
                    </div>
                  ) : null}
                </td>
                <td className="py-1.5 text-xs text-muted-foreground">
                  {holding.buyCount} buys
                  {holding.lastBuyPx !== null ? (
                    <div>
                      dern. {formatPx(holding.lastBuyPx)}
                      {holding.lastBuyAt
                        ? ` · ${formatAgo(holding.lastBuyAt)}`
                        : ""}
                    </div>
                  ) : (
                    <div>fills Buy hors fenêtre / absents</div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {whale.spotBuys.length ? (
        <div className="mt-3">
          <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
            Derniers achats spot (fills)
          </p>
          <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
            {whale.spotBuys.slice(0, 5).map((buy, index) => (
              <li key={`${whale.address}-buy-${buy.time}-${index}`}>
                {buy.baseAsset} · {formatQty(buy.qty)} @ {formatPx(buy.px)} ·{" "}
                {formatExactTime(buy.time)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}
