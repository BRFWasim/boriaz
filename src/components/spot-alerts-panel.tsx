"use client";

import { CryptoLogo } from "@/components/crypto-logo";
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
import type {
  CrowdFlowSignal,
  DashboardPayload,
  HedgeAlert,
  PriorityAlert,
  SpotHolding,
  Whale,
} from "@/lib/types";

export function SpotAlertsPanel({ data }: { data: DashboardPayload }) {
  const priority = data.priorityAlerts ?? [];
  const crowd = data.crowdFlows ?? [];
  const quotes = data.liveQuotes ?? [];
  const hedge = (data.alerts ?? []).filter((a) => a.kind !== "long_with_spot");
  const aggregate = aggregateSpot(data.whales);

  return (
    <div className="space-y-4">
      <LivePricesBar quotes={quotes} />

      <section className="rounded-xl border border-border/80 bg-card/70 p-4">
        <h2 className="text-lg font-semibold">Spot & signaux</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Prix live, alertes prioritaires (filtre anti-bruit), crowd
          long/short des wallets qualité, puis soldes spot des baleines.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <Badge variant="outline" className="border-short/40 text-short">
            Prioritaires : {priority.length}
          </Badge>
          <Badge variant="outline" className="border-short/40 text-short">
            Crowd short : {data.overview.crowdShortCount}
          </Badge>
          <Badge variant="outline" className="border-long/40 text-long">
            Crowd long : {data.overview.crowdLongCount}
          </Badge>
          <Badge variant="secondary">
            Spot total ~ {formatUsd(data.overview.totalSpotValueUsd)}
          </Badge>
          <Badge variant="outline">
            Short+spot : {data.overview.shortWithSpotCount}
          </Badge>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Filtre priorité : crowd UI · short+spot UI only (plus de notif TG) ·
          Telegram = signaux LONG/SHORT IA + bilan 2h + spikes.
        </p>
      </section>

      <section className="rounded-xl border border-border/80 bg-card/70 p-4">
        <h3 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          Alertes prioritaires
        </h3>
        {priority.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Aucune alerte prioritaire pour le moment.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {priority.map((alert) => (
              <PriorityCard key={alert.id} alert={alert} />
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border/80 bg-card/70 p-4">
        <h3 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          Crowd long / short (wallets qualité)
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Si plusieurs gros wallets à bon taux de réussite shortent (ou longent)
          le même actif en peu de temps → signal de biais. Ce n’est pas un ordre
          d’achat/vente.
        </p>
        {crowd.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Pas de consensus qualité détecté sur le top 10 actuel.
          </p>
        ) : (
          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            {crowd.map((flow) => (
              <CrowdCard key={flow.id} flow={flow} />
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border/80 bg-card/70 p-4">
        <h3 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          Spot agrégé (toutes baleines)
        </h3>
        {aggregate.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Aucun spot significatif.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-[11px] tracking-wide text-muted-foreground uppercase">
                <tr>
                  <th className="pb-2 font-medium">Actif</th>
                  <th className="pb-2 font-medium">Wallets</th>
                  <th className="pb-2 font-medium">Qty</th>
                  <th className="pb-2 font-medium">Valeur</th>
                  <th className="pb-2 font-medium">PnL latent</th>
                </tr>
              </thead>
              <tbody>
                {aggregate.map((row) => (
                  <tr key={row.baseAsset} className="border-t border-border/50">
                    <td className="py-2 font-medium">{row.baseAsset}</td>
                    <td className="numeric py-2">{row.wallets}</td>
                    <td className="numeric py-2">{formatQty(row.qty)}</td>
                    <td className="numeric py-2">{formatUsd(row.valueUsd)}</td>
                    <td
                      className={`numeric py-2 ${
                        row.pnl === null ? "" : signedClass(row.pnl)
                      }`}
                    >
                      {row.pnl === null ? "n/d" : formatUsd(row.pnl)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-dashed border-border/80 bg-muted/20 p-4">
        <h3 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          Hors Hyperliquid
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Sans clé Arkham / Nansen, on ne peut pas scanner proprement les
          wallets hors Hyperliquid (CEX, autres L1). Les APIs publiques HL
          couvrent déjà positions + spot + fills des baleines HL. Pour élargir :
          ajoute <code>ARKHAM_API_KEY</code> / <code>NANSEN_API_KEY</code> dans{" "}
          <code>.env.local</code> — labels / flux on-chain, pas un remplacement
          du leaderboard HL.
        </p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <Badge variant={data.integrations.arkham ? "secondary" : "outline"}>
            Arkham {data.integrations.arkham ? "OK" : "off"}
          </Badge>
          <Badge variant={data.integrations.nansen ? "secondary" : "outline"}>
            Nansen {data.integrations.nansen ? "OK" : "off"}
          </Badge>
        </div>
      </section>

      {hedge.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
            Autres alertes spot ↔ perps (non prioritaires)
          </h3>
          {hedge
            .filter((a) => !priority.some((p) => p.id.includes(a.id)))
            .slice(0, 12)
            .map((alert) => (
              <AlertCard key={alert.id} alert={alert} />
            ))}
        </section>
      ) : null}

      <section className="space-y-3">
        <h3 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          Portefeuilles spot par baleine
        </h3>
        {data.whales.map((whale) => (
          <WhaleSpotCard key={whale.address} whale={whale} />
        ))}
      </section>
    </div>
  );
}

function LivePricesBar({
  quotes,
}: {
  quotes: DashboardPayload["liveQuotes"];
}) {
  if (!quotes.length) {
    return (
      <section className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">
        Prix live watchlist en chargement…
      </section>
    );
  }
  return (
    <section className="overflow-x-auto rounded-xl border border-border/80 bg-card/70 p-3">
      <p className="mb-2 text-[11px] tracking-wide text-muted-foreground uppercase">
        Prix live · RENDER · ONDO · UNI · BTC · SOL · ETH · HYPE · TAO
      </p>
      <div className="flex min-w-max gap-2">
        {quotes.map((q) => (
          <div
            key={q.coin}
            className="min-w-[7.5rem] rounded-lg bg-muted/35 px-3 py-2"
          >
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <CryptoLogo symbol={q.coin} size={14} />
              {q.label}
            </p>
            <p className="numeric mt-0.5 text-sm font-medium">
              {formatPx(q.price)}
            </p>
            <p
              className={`numeric text-[11px] ${
                q.change15mPct === null ? "text-muted-foreground" : signedClass(q.change15mPct)
              }`}
            >
              15m {q.change15mPct === null ? "n/d" : formatPct(q.change15mPct, 2)}
            </p>
            <p
              className={`numeric text-[11px] ${
                q.change2hPct === null ? "text-muted-foreground" : signedClass(q.change2hPct)
              }`}
            >
              2h {q.change2hPct === null ? "n/d" : formatPct(q.change2hPct, 2)}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function PriorityCard({ alert }: { alert: PriorityAlert }) {
  const tone =
    alert.severity === "critical"
      ? "border-short/50 bg-short/10"
      : alert.severity === "warn"
        ? "border-amber-500/40 bg-amber-500/10"
        : "border-border bg-muted/30";
  return (
    <article className={`rounded-xl border px-4 py-3 ${tone}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{alert.source}</Badge>
        {alert.notifyTelegram ? (
          <Badge variant="secondary">notif TG</Badge>
        ) : (
          <Badge variant="outline">UI only</Badge>
        )}
        <h4 className="font-medium">{alert.title}</h4>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{alert.detail}</p>
      <p className="mt-1 text-xs text-muted-foreground">{alert.tags.join(" · ")}</p>
    </article>
  );
}

function CrowdCard({ flow }: { flow: CrowdFlowSignal }) {
  const tone =
    flow.side === "short"
      ? "border-short/40 bg-short/8"
      : "border-long/40 bg-long/8";
  return (
    <article className={`rounded-xl border px-4 py-3 ${tone}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant="outline"
          className={flow.side === "short" ? "text-short" : "text-long"}
        >
          {flow.side.toUpperCase()} {flow.coin}
        </Badge>
        <Badge variant="outline">{flow.kind}</Badge>
        <span className="text-xs text-muted-foreground">
          {flow.qualityWhaleCount} wallets · WR {flow.avgWinRate.toFixed(0)} %
        </span>
      </div>
      <p className="mt-2 text-sm font-medium">{flow.summary}</p>
      <p className="mt-1 text-sm text-muted-foreground">{flow.actionHint}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {flow.aliases.join(", ")}
        {flow.freshCount ? ` · ${flow.freshCount} ouvertures < 6h` : ""}
      </p>
    </article>
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
        <Badge variant="outline">
          {alert.kind === "short_with_spot"
            ? "Short + spot"
            : alert.kind === "spot_only_accumulation"
              ? "Accumulation"
              : alert.kind}
        </Badge>
        <h4 className="font-medium">{alert.title}</h4>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{alert.detail}</p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>Spot ~ {formatUsd(alert.spotValueUsd)}</span>
        <span>Qty {formatQty(alert.spotQty)}</span>
        {alert.perpNotionalUsd !== null ? (
          <span>Perps ~ {formatUsd(alert.perpNotionalUsd)}</span>
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
          {whale.winRate !== null ? (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              WR{" "}
              {(whale.tradeStats.winRatePct ??
                (whale.winRate <= 1.5 ? whale.winRate * 100 : whale.winRate)
              ).toFixed(1)}{" "}
              % ({whale.tradeStats.sample || whale.winSample})
            </span>
          ) : null}
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
              <SpotRow
                key={`${whale.address}-${holding.coin}`}
                holding={holding}
              />
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

function SpotRow({ holding }: { holding: SpotHolding }) {
  return (
    <tr className="border-t border-border/50">
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
          holding.unrealizedPnl === null ? "" : signedClass(holding.unrealizedPnl)
        }`}
      >
        {holding.unrealizedPnl === null ? "n/d" : formatUsd(holding.unrealizedPnl)}
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
            {holding.lastBuyAt ? ` · ${formatAgo(holding.lastBuyAt)}` : ""}
          </div>
        ) : (
          <div>fills Buy hors fenêtre / absents</div>
        )}
      </td>
    </tr>
  );
}

function aggregateSpot(whales: Whale[]) {
  const map = new Map<
    string,
    { baseAsset: string; wallets: number; qty: number; valueUsd: number; pnl: number | null }
  >();
  for (const whale of whales) {
    const seen = new Set<string>();
    for (const h of whale.spot) {
      const cur = map.get(h.baseAsset) ?? {
        baseAsset: h.baseAsset,
        wallets: 0,
        qty: 0,
        valueUsd: 0,
        pnl: 0,
      };
      if (!seen.has(h.baseAsset)) {
        cur.wallets += 1;
        seen.add(h.baseAsset);
      }
      cur.qty += h.qty;
      cur.valueUsd += h.valueUsd;
      if (h.unrealizedPnl !== null) {
        cur.pnl = (cur.pnl ?? 0) + h.unrealizedPnl;
      }
      map.set(h.baseAsset, cur);
    }
  }
  return [...map.values()].sort((a, b) => b.valueUsd - a.valueUsd);
}
