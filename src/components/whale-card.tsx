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
  formatPct,
  formatPx,
  formatQty,
  formatUsd,
  formatWinRate,
  signedClass,
  truncateAddress,
} from "@/lib/format";
import type { ClosedPosition, OpenPosition, ProtectionLevel, Whale } from "@/lib/types";

export function WhaleCard({ whale, coinFilter }: { whale: Whale; coinFilter: string }) {
  const [copied, setCopied] = useState(false);
  const [showAllPos, setShowAllPos] = useState(false);
  const [showAllClosed, setShowAllClosed] = useState(false);

  const positions =
    coinFilter === "all"
      ? whale.positions
      : whale.positions.filter((position) => position.coin === coinFilter);
  const closed =
    coinFilter === "all"
      ? whale.closed
      : whale.closed.filter((position) => position.coin === coinFilter);

  const visiblePos = showAllPos ? positions : positions.slice(0, 6);
  const visibleClosed = showAllClosed ? closed : closed.slice(0, 6);

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
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
            <Stat
              label="Portefeuille perps"
              value={formatUsd(whale.portfolioUsd)}
              title={`Leaderboard : ${formatUsd(whale.leaderboardValue)}`}
            />
            <Stat
              label="PnL 24h"
              value={formatUsd(whale.pnl24h)}
              className={signedClass(whale.pnl24h)}
            />
            <Stat
              label="Win rate"
              value={formatWinRate(whale.winRate, whale.winSample)}
              hint={
                whale.winSample
                  ? `Sur ${whale.winSample} clôtures (fills)`
                  : "Pas assez de clôtures dans l’historique"
              }
            />
            <Stat label="Positions" value={String(whale.positions.length)} />
          </div>
        </div>
        {whale.error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Données partielles : {whale.error}
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-8 pt-5">
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
            <div className="overflow-x-auto rounded-lg border border-border/70">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="bg-muted/50 text-[11px] tracking-wide text-muted-foreground uppercase">
                  <tr>
                    <th className="px-3 py-2 font-medium">Crypto</th>
                    <th className="px-3 py-2 font-medium">Sens</th>
                    <th className="px-3 py-2 font-medium">Taille</th>
                    <th className="px-3 py-2 font-medium">Levier</th>
                    <th className="px-3 py-2 font-medium">Entrée</th>
                    <th className="px-3 py-2 font-medium">Marché</th>
                    <th className="px-3 py-2 font-medium">PnL latent</th>
                    <th className="px-3 py-2 font-medium">Stop-loss</th>
                    <th className="px-3 py-2 font-medium">Take-profit</th>
                    <th className="px-3 py-2 font-medium">Ouverture</th>
                  </tr>
                </thead>
                <tbody>
                  {visiblePos.map((position) => (
                    <PositionRow key={`${whale.address}-${position.coin}-${position.side}`} position={position} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {positions.length > 6 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => setShowAllPos((value) => !value)}
            >
              {showAllPos ? "Réduire" : `Voir les ${positions.length - 6} autres positions`}
            </Button>
          ) : null}
        </section>

        <section>
          <h3 className="mb-3 text-sm font-medium tracking-wide text-muted-foreground uppercase">
            Positions récemment clôturées
          </h3>
          {visibleClosed.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
              Aucune clôture récente dans l’historique public des fills.
            </p>
          ) : (
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
                  {visibleClosed.map((position, index) => (
                    <ClosedRow
                      key={`${whale.address}-c-${position.coin}-${position.closedAt}-${index}`}
                      position={position}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {closed.length > 6 ? (
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

function PositionRow({ position }: { position: OpenPosition }) {
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
    return (
      <Badge variant="secondary">
        Ordre déclencheur
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      Clôture manuelle
    </Badge>
  );
}
