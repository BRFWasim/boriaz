"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  displayCoin,
  formatAgo,
  formatExactTime,
  formatFundingRate,
  formatPct,
  formatPx,
  formatQty,
  formatRoi,
  formatUsd,
  formatWinRate,
  riskClass,
  signedClass,
  truncateAddress,
} from "@/lib/format";
import type {
  ClosedPosition,
  OpenPosition,
  ProtectionLevel,
  UiMode,
  Whale,
} from "@/lib/types";

export function WhaleCard({
  whale,
  coinFilter,
  mode,
}: {
  whale: Whale;
  coinFilter: string;
  mode: UiMode;
}) {
  const [copied, setCopied] = useState(false);
  const [showAllPos, setShowAllPos] = useState(false);
  const [closedOpen, setClosedOpen] = useState(false);
  const [showAllClosed, setShowAllClosed] = useState(false);

  const positions =
    coinFilter === "all"
      ? whale.positions
      : whale.positions.filter((position) => position.coin === coinFilter);
  const closed =
    coinFilter === "all"
      ? whale.closed
      : whale.closed.filter((position) => position.coin === coinFilter);

  const posLimit = mode === "simple" ? 4 : 6;
  const visiblePos = showAllPos ? positions : positions.slice(0, posLimit);
  const visibleClosed = showAllClosed ? closed : closed.slice(0, 6);
  const dense = mode === "simple";
  const showClosed = mode === "advanced" || closedOpen;

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(whale.address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Card className="border-border/80 bg-card/90 shadow-none">
      <CardHeader className="gap-4 border-b border-border/60">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="numeric border-primary/40 text-primary">
                #{whale.rank}
              </Badge>
              <h2 className="truncate text-lg font-semibold tracking-tight">{whale.alias}</h2>
              {whale.alerts.some((a) => a.kind === "short_with_spot") ? (
                <Badge className="border-short/40 bg-short/15 text-short" variant="outline">
                  Short + spot
                </Badge>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="numeric rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                {truncateAddress(whale.address)}
              </code>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={copyAddress}
                aria-label="Copier l’adresse"
              >
                {copied ? <CheckIcon /> : <CopyIcon />}
                {copied ? "Copiée" : "Copier"}
              </Button>
              <a
                href={`https://app.hyperliquid.xyz/explorer/address/${whale.address}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-primary hover:underline"
              >
                Explorer
              </a>
            </div>
          </div>
          <div className="grid w-full grid-cols-2 gap-x-4 gap-y-2 text-sm sm:w-auto sm:grid-cols-4 sm:gap-x-6">
            <Stat
              label="Portefeuille"
              value={formatUsd(whale.portfolioUsd)}
              title={`Leaderboard : ${formatUsd(whale.leaderboardValue)}`}
            />
            <Stat
              label="PnL 24h"
              value={formatUsd(whale.day.pnl)}
              className={signedClass(whale.day.pnl)}
              hint={dense ? undefined : `ROI ${formatRoi(whale.day.roi)}`}
            />
            <Stat
              label="Win rate"
              value={formatWinRate(whale.tradeStats.winRate, whale.tradeStats.sample)}
              hint={
                dense
                  ? undefined
                  : whale.tradeStats.sample
                    ? `${whale.tradeStats.sample} clôtures · PF ${
                        whale.tradeStats.profitFactor === null
                          ? "n/d"
                          : Number.isFinite(whale.tradeStats.profitFactor)
                            ? whale.tradeStats.profitFactor.toFixed(2)
                            : "∞"
                      }`
                    : "Pas assez de clôtures"
              }
            />
            <Stat
              label="Risque"
              value={`${whale.riskScore}/100`}
              className={riskClass(whale.riskLabel)}
              hint={dense ? whale.riskLabel : `${whale.riskLabel} · biais ${whale.bias}`}
            />
          </div>
        </div>
        {!dense ? (
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 lg:grid-cols-8">
            <Mini label="PnL 7j" value={formatUsd(whale.week.pnl)} className={signedClass(whale.week.pnl)} />
            <Mini label="PnL 30j" value={formatUsd(whale.month.pnl)} className={signedClass(whale.month.pnl)} />
            <Mini label="All-time" value={formatUsd(whale.allTime.pnl)} className={signedClass(whale.allTime.pnl)} />
            <Mini label="Vol. 24h" value={formatUsd(whale.day.volume)} />
            <Mini label="Long" value={formatUsd(whale.exposure.longUsd)} className="text-long" />
            <Mini label="Short" value={formatUsd(whale.exposure.shortUsd)} className="text-short" />
            <Mini
              label="Levier moy."
              value={`${whale.exposure.avgLeverage.toFixed(1)}×`}
            />
            <Mini
              label="Marge"
              value={formatPct(whale.exposure.marginRatio, 1).replace("+", "")}
            />
            <Mini
              label="PnL latent"
              value={formatUsd(whale.exposure.unrealizedTotal)}
              className={signedClass(whale.exposure.unrealizedTotal)}
            />
            <Mini
              label="Funding ouvert"
              value={formatUsd(whale.exposure.fundingOpenTotal)}
              className={signedClass(-whale.exposure.fundingOpenTotal)}
            />
            <Mini
              label="SL / TP"
              value={`${whale.exposure.protectedWithSl}/${whale.positions.length} · ${whale.exposure.protectedWithTp}/${whale.positions.length}`}
            />
            <Mini
              label="Near liq."
              value={String(whale.exposure.nearLiquidationCount)}
              className={
                whale.exposure.nearLiquidationCount > 0 ? "text-short" : undefined
              }
            />
            <Mini
              label="Expectancy"
              value={
                whale.tradeStats.expectancy === null
                  ? "n/d"
                  : formatUsd(whale.tradeStats.expectancy)
              }
              className={
                whale.tradeStats.expectancy === null
                  ? undefined
                  : signedClass(whale.tradeStats.expectancy)
              }
            />
            <Mini
              label="Concentration"
              value={
                whale.exposure.concentrationTopCoin
                  ? `${whale.exposure.concentrationTopCoin} ${formatPct(
                      whale.exposure.concentrationTopPct,
                      0,
                    ).replace("+", "")}`
                  : "n/d"
              }
            />
            <Mini label="Withdrawable" value={formatUsd(whale.exposure.withdrawable)} />
            <Mini label="Frais (échantillon)" value={formatUsd(whale.tradeStats.feesPaid)} />
          </div>
        ) : (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              Long {formatUsd(whale.exposure.longUsd)} / Short{" "}
              {formatUsd(whale.exposure.shortUsd)}
            </span>
            <span>Levier moy. {whale.exposure.avgLeverage.toFixed(1)}×</span>
            <span>
              Latent{" "}
              <span className={signedClass(whale.exposure.unrealizedTotal)}>
                {formatUsd(whale.exposure.unrealizedTotal)}
              </span>
            </span>
            <span>
              SL {whale.exposure.protectedWithSl}/{whale.positions.length}
            </span>
          </div>
        )}
        {whale.error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Données partielles : {whale.error}
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-6 pt-5">
        <section>
          <h3 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">
            Positions ouvertes
          </h3>
          {visiblePos.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
              {coinFilter === "all"
                ? "Aucune position perps ouverte sur ce compte pour le moment."
                : `Pas de position ouverte sur ${coinFilter}.`}
            </p>
          ) : (
            <>
              <div
                className={
                  mode === "advanced" ? "hidden md:block" : "hidden"
                }
              >
                <PositionTable whale={whale} positions={visiblePos} />
              </div>
              <div
                className={
                  mode === "advanced"
                    ? "grid gap-2 md:hidden"
                    : "grid gap-2"
                }
              >
                {visiblePos.map((position) => (
                  <PositionTile
                    key={`${whale.address}-${position.coin}-${position.side}`}
                    position={position}
                    dense={dense}
                  />
                ))}
              </div>
            </>
          )}
          {positions.length > posLimit ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => setShowAllPos((value) => !value)}
            >
              {showAllPos ? "Réduire" : `Voir les ${positions.length - posLimit} autres`}
            </Button>
          ) : null}
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
              Clôtures récentes
            </h3>
            {dense ? (
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => setClosedOpen((value) => !value)}
              >
                {showClosed ? "Masquer" : `Afficher (${closed.length})`}
              </Button>
            ) : null}
          </div>
          {!showClosed && dense ? (
            <p className="text-sm text-muted-foreground">
              {closed.length
                ? `${closed.length} clôture${closed.length > 1 ? "s" : ""} dans l’historique — afficher pour le détail.`
                : "Aucune clôture récente dans l’historique public."}
            </p>
          ) : visibleClosed.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
              Aucune clôture récente dans l’historique public des fills.
            </p>
          ) : (
            <>
              <div className={mode === "advanced" ? "hidden md:block" : "hidden"}>
                <ClosedTable whale={whale} closed={visibleClosed} />
              </div>
              <div className={mode === "advanced" ? "grid gap-2 md:hidden" : "grid gap-2"}>
                {visibleClosed.map((position, index) => (
                  <ClosedTile
                    key={`${whale.address}-c-${position.coin}-${position.closedAt}-${index}`}
                    position={position}
                    dense={dense}
                  />
                ))}
              </div>
            </>
          )}
          {showClosed && closed.length > 6 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => setShowAllClosed((value) => !value)}
            >
              {showAllClosed ? "Réduire" : `Voir l’historique (${closed.length})`}
            </Button>
          ) : null}
        </section>
      </CardContent>
    </Card>
  );
}

function PositionTable({
  whale,
  positions,
}: {
  whale: Whale;
  positions: OpenPosition[];
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border/70">
      <table className="w-full min-w-[1180px] text-left text-sm">
        <thead className="bg-muted/50 text-[11px] tracking-wide text-muted-foreground uppercase">
          <tr>
            <th className="px-3 py-2 font-medium">Crypto</th>
            <th className="px-3 py-2 font-medium">Sens</th>
            <th className="px-3 py-2 font-medium">Taille</th>
            <th className="px-3 py-2 font-medium">Levier</th>
            <th className="px-3 py-2 font-medium">Entrée</th>
            <th className="px-3 py-2 font-medium">Marché</th>
            <th className="px-3 py-2 font-medium">PnL latent</th>
            <th className="px-3 py-2 font-medium">Liq. / dist.</th>
            <th className="px-3 py-2 font-medium">Funding</th>
            <th className="px-3 py-2 font-medium">Stop-loss</th>
            <th className="px-3 py-2 font-medium">Take-profit</th>
            <th className="px-3 py-2 font-medium">Ouverture</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((position) => (
            <PositionRow
              key={`${whale.address}-${position.coin}-${position.side}`}
              position={position}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClosedTable({ whale, closed }: { whale: Whale; closed: ClosedPosition[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border/70">
      <table className="w-full min-w-[820px] text-left text-sm">
        <thead className="bg-muted/50 text-[11px] tracking-wide text-muted-foreground uppercase">
          <tr>
            <th className="px-3 py-2 font-medium">Crypto</th>
            <th className="px-3 py-2 font-medium">Sens</th>
            <th className="px-3 py-2 font-medium">Entrée → sortie</th>
            <th className="px-3 py-2 font-medium">Taille</th>
            <th className="px-3 py-2 font-medium">PnL réalisé</th>
            <th className="px-3 py-2 font-medium">SL / TP</th>
            <th className="px-3 py-2 font-medium">Clôture</th>
          </tr>
        </thead>
        <tbody>
          {closed.map((position, index) => (
            <ClosedRow
              key={`${whale.address}-c-${position.coin}-${position.closedAt}-${index}`}
              position={position}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PositionTile({
  position,
  dense,
}: {
  position: OpenPosition;
  dense: boolean;
}) {
  const coin = displayCoin(position.coin);
  return (
    <article className="rounded-xl border border-border/70 bg-muted/25 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-semibold">{coin.symbol}</span>
          {coin.dex ? (
            <span className="text-[11px] text-muted-foreground">{coin.dex}</span>
          ) : null}
          <SideBadge side={position.side} />
          <span className="numeric text-xs text-muted-foreground">
            {position.leverage}× {position.leverageType === "isolated" ? "isolé" : "cross"}
          </span>
        </div>
        <p className={`numeric shrink-0 font-medium ${signedClass(position.unrealizedPnl)}`}>
          {formatUsd(position.unrealizedPnl)}
        </p>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span className="numeric">{formatUsd(position.notionalUsd)}</span>
        <span className="numeric text-muted-foreground">
          {formatQty(position.qty)} {coin.symbol}
        </span>
        <span className="numeric text-muted-foreground">
          Entrée {formatPx(position.entryPx)}
        </span>
        <span className="numeric text-muted-foreground">
          Mark {position.markPx !== null ? formatPx(position.markPx) : "n/d"}
        </span>
        {position.distanceToLiqPct !== null ? (
          <span
            className={`numeric ${
              position.distanceToLiqPct < 8 ? "text-short" : "text-muted-foreground"
            }`}
          >
            Liq {formatPct(position.distanceToLiqPct, 1).replace("+", "")}
          </span>
        ) : null}
      </div>
      <div className={`mt-2 grid gap-2 ${dense ? "grid-cols-2" : "grid-cols-1 sm:grid-cols-3"}`}>
        <ProtectionChip kind="sl" level={position.sl} compact={dense} />
        <ProtectionChip kind="tp" level={position.tp} compact={dense} />
        {!dense ? (
          <div className="text-xs text-muted-foreground">
            {position.openedAt ? (
              <>
                <div className="text-[11px] tracking-wide uppercase">Ouverture</div>
                <div>{formatExactTime(position.openedAt)}</div>
                <div>{formatAgo(position.openedAt)}</div>
              </>
            ) : (
              <span className="italic">
                Heure d’ouverture hors historique des fills
              </span>
            )}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function ClosedTile({
  position,
  dense,
}: {
  position: ClosedPosition;
  dense: boolean;
}) {
  const coin = displayCoin(position.coin);
  return (
    <article className="rounded-xl border border-border/70 bg-muted/20 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{coin.symbol}</span>
          <SideBadge side={position.side} />
          <ExitBadge reason={position.exitReason} />
        </div>
        <p className={`numeric font-medium ${signedClass(position.realizedPnl)}`}>
          {formatUsd(position.realizedPnl)}
        </p>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span className="numeric">
          {formatPx(position.entryPx)} → {formatPx(position.exitPx)}
        </span>
        <span className="numeric">
          {formatQty(position.qty)} {coin.symbol}
        </span>
        {!dense ? (
          <span>
            {formatExactTime(position.closedAt)} · {formatAgo(position.closedAt)}
          </span>
        ) : (
          <span>{formatAgo(position.closedAt)}</span>
        )}
      </div>
    </article>
  );
}

function Stat({
  label,
  value,
  className,
  hint,
  title,
}: {
  label: string;
  value: string;
  className?: string;
  hint?: string;
  title?: string;
}) {
  return (
    <div title={title ?? hint}>
      <p className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className={`numeric mt-0.5 font-medium ${className ?? ""}`}>{value}</p>
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Mini({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="rounded-md bg-muted/30 px-2 py-1.5">
      <p className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className={`numeric mt-0.5 font-medium ${className ?? ""}`}>{value}</p>
    </div>
  );
}

function PositionRow({
  position,
}: {
  position: OpenPosition;
}) {
  const coin = displayCoin(position.coin);
  return (
    <tr className="border-t border-border/50 align-top">
      <td className="px-3 py-2.5">
        <div className="font-medium">{coin.symbol}</div>
        {coin.dex ? (
          <div className="text-[11px] text-muted-foreground">{coin.dex}</div>
        ) : null}
      </td>
      <td className="px-3 py-2.5">
        <SideBadge side={position.side} />
      </td>
      <td className="numeric px-3 py-2.5">
        <div>{formatUsd(position.notionalUsd)}</div>
        <div className="text-[11px] text-muted-foreground">
          {formatQty(position.qty)} {coin.symbol}
        </div>
      </td>
      <td className="numeric px-3 py-2.5">
        {position.leverage}×
        <div className="text-[11px] text-muted-foreground">
          {position.leverageType === "isolated" ? "isolé" : "cross"}
        </div>
      </td>
      <td className="numeric px-3 py-2.5">{formatPx(position.entryPx)}</td>
      <td className="numeric px-3 py-2.5">
        {position.markPx !== null ? formatPx(position.markPx) : "n/d"}
      </td>
      <td className={`numeric px-3 py-2.5 ${signedClass(position.unrealizedPnl)}`}>
        {formatUsd(position.unrealizedPnl)}
        {position.moveFromEntryPct !== null ? (
          <div className="text-[11px] text-muted-foreground">
            {formatPct(position.moveFromEntryPct, 2)} vs entrée
          </div>
        ) : null}
      </td>
      <td className="numeric px-3 py-2.5 text-xs">
        {position.liquidationPx !== null ? (
          <>
            <div>{formatPx(position.liquidationPx)}</div>
            <div
              className={
                position.distanceToLiqPct !== null && position.distanceToLiqPct < 8
                  ? "text-short"
                  : "text-muted-foreground"
              }
            >
              {position.distanceToLiqPct !== null
                ? `${formatPct(position.distanceToLiqPct, 1).replace("+", "")} au mark`
                : "dist. n/d"}
            </div>
          </>
        ) : (
          <span className="italic text-muted-foreground">n/d</span>
        )}
      </td>
      <td className="numeric px-3 py-2.5 text-xs">
        <div className={signedClass(-position.fundingSinceOpen)}>
          {formatUsd(position.fundingSinceOpen)} depuis ouv.
        </div>
        <div className="text-muted-foreground">
          taux {formatFundingRate(position.fundingRate8h)}
        </div>
      </td>
      <td className="px-3 py-2.5">
        <ProtectionCell kind="sl" level={position.sl} />
      </td>
      <td className="px-3 py-2.5">
        <ProtectionCell kind="tp" level={position.tp} />
      </td>
      <td className="px-3 py-2.5 text-xs">
        {position.openedAt ? (
          <>
            <div>{formatExactTime(position.openedAt)}</div>
            <div className="text-muted-foreground">{formatAgo(position.openedAt)}</div>
          </>
        ) : (
          <span className="italic text-muted-foreground">
            Hors de l’historique des fills (≈ 2000 derniers) — heure non disponible
          </span>
        )}
      </td>
    </tr>
  );
}

function ClosedRow({ position }: { position: ClosedPosition }) {
  const coin = displayCoin(position.coin);
  return (
    <tr className="border-t border-border/50 align-top">
      <td className="px-3 py-2.5 font-medium">{coin.symbol}</td>
      <td className="px-3 py-2.5">
        <SideBadge side={position.side} />
      </td>
      <td className="numeric px-3 py-2.5">
        {formatPx(position.entryPx)} → {formatPx(position.exitPx)}
      </td>
      <td className="numeric px-3 py-2.5">
        {formatQty(position.qty)} {coin.symbol}
      </td>
      <td className={`numeric px-3 py-2.5 ${signedClass(position.realizedPnl)}`}>
        {formatUsd(position.realizedPnl)}
      </td>
      <td className="px-3 py-2.5">
        <ExitBadge reason={position.exitReason} />
      </td>
      <td className="px-3 py-2.5 text-xs">
        <div>{formatExactTime(position.closedAt)}</div>
        <div className="text-muted-foreground">{formatAgo(position.closedAt)}</div>
      </td>
    </tr>
  );
}

function SideBadge({ side }: { side: "long" | "short" }) {
  return (
    <Badge
      variant="outline"
      className={
        side === "long"
          ? "border-long/40 bg-long/10 text-long"
          : "border-short/40 bg-short/10 text-short"
      }
    >
      {side === "long" ? "Long" : "Short"}
    </Badge>
  );
}

function ProtectionChip({
  kind,
  level,
  compact,
}: {
  kind: "sl" | "tp";
  level: ProtectionLevel | null;
  compact: boolean;
}) {
  const label = kind === "sl" ? "SL" : "TP";
  if (!level) {
    return (
      <div className="rounded-md bg-background/50 px-2 py-1.5 text-xs">
        <span className="text-muted-foreground">{label} non défini</span>
      </div>
    );
  }
  const abs = Math.abs(level.distancePct);
  const dir =
    level.distancePct < 0
      ? "sous le mark"
      : level.distancePct > 0
        ? "au-dessus"
        : "au mark";
  return (
    <div className="rounded-md bg-background/50 px-2 py-1.5 text-xs">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-muted-foreground">{label}</span>
        <span className="numeric font-medium">{formatPx(level.price)}</span>
      </div>
      <div className="text-muted-foreground">
        {formatPct(abs, 2).replace("+", "")} {dir}
        {compact ? null : ` · ${level.orderType}`}
      </div>
    </div>
  );
}

function ProtectionCell({
  kind,
  level,
}: {
  kind: "sl" | "tp";
  level: ProtectionLevel | null;
}) {
  if (!level) {
    return (
      <div>
        <span className="italic text-muted-foreground">Non défini</span>
        <p className="text-[11px] text-muted-foreground">
          Aucun ordre {kind === "sl" ? "stop-loss" : "take-profit"} n’est associé à cette
          position.
        </p>
      </div>
    );
  }
  const abs = Math.abs(level.distancePct);
  const dir =
    level.distancePct < 0
      ? "sous le mark"
      : level.distancePct > 0
        ? "au-dessus du mark"
        : "au mark";
  return (
    <div>
      <div className="numeric font-medium">{formatPx(level.price)}</div>
      <div className="text-[11px] text-muted-foreground">
        {formatPct(abs, 2).replace("+", "")} {dir}
      </div>
      <div className="text-[11px] text-muted-foreground">
        {level.orderType}
        {level.isPositionLevel ? " · position" : ""}
      </div>
    </div>
  );
}

function ExitBadge({ reason }: { reason: ClosedPosition["exitReason"] }) {
  if (reason === "sl") {
    return (
      <Badge className="border-short/40 bg-short/15 text-short" variant="outline">
        SL touché
      </Badge>
    );
  }
  if (reason === "tp") {
    return (
      <Badge className="border-long/40 bg-long/15 text-long" variant="outline">
        TP touché
      </Badge>
    );
  }
  if (reason === "trigger") {
    return <Badge variant="secondary">Ordre déclencheur</Badge>;
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      Clôture manuelle
    </Badge>
  );
}
