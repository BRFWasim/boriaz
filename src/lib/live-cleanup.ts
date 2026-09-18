/**
 * Nettoyage LIVE : annuler les GTC / limites déjà dépassées ou structure morte.
 * Libère la place pour de nouveaux trades à espérance positive.
 */
import {
  getExchangeClient,
  getLiveConfig,
  isLiveEnvReady,
  isProtectiveOpenOrder,
  loadAssetMap,
  makeTransport,
} from "./hl-live";
import { InfoClient } from "@nktkas/hyperliquid";
import { loadCandles } from "./market-analysis";
import { analyzeSmcSetup } from "./smc";

function midPastTp1(
  side: "long" | "short",
  mid: number,
  tp1: number,
): boolean {
  return side === "long" ? mid >= tp1 : mid <= tp1;
}

function tooFarFromEntry(
  side: "long" | "short",
  mid: number,
  entry: number,
  sl: number,
): boolean {
  const risk = Math.abs(entry - sl);
  if (!(risk > 0)) return false;
  // Prix a couru >1.2R dans le sens du trade sans fill → limite dépassée
  const r =
    side === "long" ? (mid - entry) / risk : (entry - mid) / risk;
  return r >= 1.2;
}

export async function cleanupStaleLiveLimits(): Promise<{
  checked: number;
  cancelled: number;
  closedJournal: number;
  notes: string[];
}> {
  const ready = isLiveEnvReady();
  if (!ready.ok) {
    return {
      checked: 0,
      cancelled: 0,
      closedJournal: 0,
      notes: [ready.reason || "env"],
    };
  }
  const cfg = getLiveConfig();
  if (!cfg.accountAddress) {
    return {
      checked: 0,
      cancelled: 0,
      closedJournal: 0,
      notes: ["no address"],
    };
  }

  const notes: string[] = [];
  let cancelled = 0;
  let closedJournal = 0;
  let checked = 0;

  const { loadLiveJournal, updateLiveJournalEntry } = await import(
    "./live-journal"
  );
  const journal = (await loadLiveJournal()).filter((e) => e.status === "open");
  const info = new InfoClient({ transport: makeTransport(cfg.testnet) });
  const mids = await info.allMids();
  const opens = await info.frontendOpenOrders({
    user: cfg.accountAddress as `0x${string}`,
  });
  const assets = await loadAssetMap(cfg.testnet);
  const client = getExchangeClient(cfg.testnet);

  // Portfolio : si pas de position, les limits d’entrée sont des GTC resting
  const { fetchLivePortfolio } = await import("./hl-live");
  const portfolio = await fetchLivePortfolio();
  const positions = portfolio.ok ? portfolio.positions : [];
  const posCoins = new Set(positions.map((p) => p.coin.toUpperCase()));
  const posSizeByCoin = new Map(
    positions.map((p) => [p.coin.toUpperCase(), Math.abs(Number(p.size) || 0)]),
  );

  for (const entry of journal) {
    checked += 1;
    const mid = Number(
      mids[entry.coin] ?? mids[entry.coin.toUpperCase()] ?? 0,
    );
    if (!(mid > 0)) continue;
    const hasPos = posCoins.has(entry.coin.toUpperCase());
    const tp1 = Number(entry.tp1 ?? entry.tp);
    const surpassed =
      midPastTp1(entry.side, mid, tp1) ||
      tooFarFromEntry(entry.side, mid, entry.entry, entry.sl);

    // Structure morte : re-scan rapide — si plus de checklist → cancel
    let structureDead = false;
    if (!hasPos) {
      try {
        const [d1, h4, h1, m15] = await Promise.all([
          loadCandles(entry.coin, "1d"),
          loadCandles(entry.coin, "4h"),
          loadCandles(entry.coin, "1h"),
          loadCandles(entry.coin, "15m"),
        ]);
        const setup = analyzeSmcSetup({
          coin: entry.coin,
          price: mid,
          candlesD1: d1,
          candlesH4: h4,
          candlesH1: h1,
          candlesExec: m15,
          walletEur: 1000,
          maxLeverage: 8,
        });
        if (
          !setup.checklist.allPass ||
          setup.side !== entry.side ||
          setup.status === "ANNULÉ"
        ) {
          structureDead = true;
        }
      } catch {
        /* best-effort */
      }
    }

    if (!hasPos && (surpassed || structureDead)) {
      const asset = assets.get(entry.coin.toUpperCase());
      if (!asset) continue;
      const toCancel = (opens ?? [])
        .filter(
          (o) =>
            String(o.coin || "").toUpperCase() === entry.coin.toUpperCase() &&
            !isProtectiveOpenOrder(o),
        )
        .map((o) => ({ a: asset.id, o: Number(o.oid) }))
        .filter((c) => Number.isFinite(c.o));
      // Aussi cancel TP/SL orphelins sans position
      const protect = (opens ?? [])
        .filter(
          (o) =>
            String(o.coin || "").toUpperCase() === entry.coin.toUpperCase() &&
            isProtectiveOpenOrder(o),
        )
        .map((o) => ({ a: asset.id, o: Number(o.oid) }))
        .filter((c) => Number.isFinite(c.o));
      const cancels = [...toCancel, ...protect];
      if (cancels.length) {
        try {
          await client.cancel({ cancels });
          cancelled += cancels.length;
        } catch (e) {
          notes.push(
            `${entry.coin}: cancel err ${e instanceof Error ? e.message : "x"}`,
          );
          continue;
        }
      }
      await updateLiveJournalEntry(entry.id, {
        status: "closed",
        closedAt: Date.now(),
      });
      closedJournal += 1;
      notes.push(
        `${entry.coin}: GTC nettoyé (${surpassed ? "dépassé/trop loin" : "structure morte"}) · ${cancels.length} oid`,
      );
    }
  }

  // Orphan HL : limites d’entrée trop loin OU TP/SL protectifs sans position
  for (const o of opens ?? []) {
    const coin = String(o.coin || "").toUpperCase();
    if (!coin) continue;
    if (posCoins.has(coin)) continue;
    const inJournal = journal.some(
      (e) => e.coin.toUpperCase() === coin && e.status === "open",
    );
    // Journal open géré plus haut (structure/surpassed) — ici orphelins purs
    if (inJournal) continue;

    const protective = isProtectiveOpenOrder(o);
    const mid = Number(mids[coin] ?? 0);
    const limitPx = Number(
      (o as { limitPx?: string | number }).limitPx ??
        (o as { px?: string | number }).px ??
        0,
    );
    const asset = assets.get(coin);
    if (!asset) continue;
    const oid = Number(o.oid);
    if (!Number.isFinite(oid)) continue;

    if (protective) {
      // TP/SL reduceOnly sans position = mort → libère le book HL
      try {
        await client.cancel({ cancels: [{ a: asset.id, o: oid }] });
        cancelled += 1;
        notes.push(`${coin}: orphan TP/SL cancel oid=${oid}`);
      } catch {
        /* ignore */
      }
      continue;
    }

    if (!(mid > 0 && limitPx > 0)) continue;
    const distPct = Math.abs(mid - limitPx) / mid;
    // Limite orpheline >1.5% du mid → nettoyer
    if (distPct < 0.015) continue;
    try {
      await client.cancel({ cancels: [{ a: asset.id, o: oid }] });
      cancelled += 1;
      notes.push(
        `${coin}: orphan limit cancel oid=${oid} dist=${(distPct * 100).toFixed(1)}%`,
      );
    } catch {
      /* ignore */
    }
  }

  // Dédupe TP/SL : trail/repair peut re-placer sans cancel → 2 sets (ex. DOGE)
  const byCoin = new Map<string, NonNullable<typeof opens>>();
  for (const o of opens ?? []) {
    if (!isProtectiveOpenOrder(o)) continue;
    const coin = String(o.coin || "").toUpperCase();
    if (!coin || !posCoins.has(coin)) continue;
    const list = byCoin.get(coin) ?? [];
    list.push(o);
    byCoin.set(coin, list);
  }
  for (const [coin, list] of byCoin) {
    const posSz = posSizeByCoin.get(coin) ?? 0;
    if (!(posSz > 0) || list.length < 2) continue;
    type Row = {
      oid: number;
      ts: number;
      sz: number;
      isTp: boolean;
    };
    const rows: Row[] = list
      .map((o) => {
        const ot = String(o.orderType || "");
        const isTp = /take\s*profit/i.test(ot);
        return {
          oid: Number(o.oid),
          ts: Number(
            (o as { timestamp?: number }).timestamp ??
              (o as { ts?: number }).ts ??
              0,
          ),
          sz: Number(o.sz ?? (o as { origSz?: string | number }).origSz ?? 0),
          isTp,
        };
      })
      .filter((r) => Number.isFinite(r.oid));
    // Groupes ≈ même placement (fenêtre 3s)
    const groups = new Map<number, Row[]>();
    for (const r of rows) {
      const key = Math.floor(r.ts / 3000) * 3000;
      const g = groups.get(key) ?? [];
      g.push(r);
      groups.set(key, g);
    }
    if (groups.size < 2) {
      const sls = rows.filter((r) => !r.isTp).sort((a, b) => b.oid - a.oid);
      if (sls.length > 1) {
        const asset = assets.get(coin);
        if (!asset) continue;
        const drop = sls.slice(1);
        try {
          await client.cancel({
            cancels: drop.map((d) => ({ a: asset.id, o: d.oid })),
          });
          cancelled += drop.length;
          notes.push(
            `${coin}: dédup SL ×${drop.length} (garde oid=${sls[0]!.oid})`,
          );
        } catch {
          /* ignore */
        }
      }
      continue;
    }
    // Score : TP qui collent à la taille + multi TP1/TP2 + au moins 1 SL
    let bestKey = -1;
    let bestScore = -Infinity;
    for (const [key, g] of groups) {
      const tpSum = g.filter((r) => r.isTp).reduce((s, r) => s + r.sz, 0);
      const hasSl = g.some((r) => !r.isTp);
      const tpFit =
        posSz > 0 ? 1 - Math.min(1, Math.abs(tpSum - posSz) / posSz) : 0;
      const multiTp = g.filter((r) => r.isTp).length >= 2 ? 0.35 : 0;
      const score = (hasSl ? 1 : 0) + tpFit + multiTp - key / 1e15;
      if (score > bestScore) {
        bestScore = score;
        bestKey = key;
      }
    }
    if (bestKey < 0) continue;
    const keepOids = new Set((groups.get(bestKey) ?? []).map((r) => r.oid));
    const drop = rows.filter((r) => !keepOids.has(r.oid));
    if (!drop.length) continue;
    const asset = assets.get(coin);
    if (!asset) continue;
    try {
      await client.cancel({
        cancels: drop.map((d) => ({ a: asset.id, o: d.oid })),
      });
      cancelled += drop.length;
      notes.push(
        `${coin}: dédup TPSL ×${drop.length} (garde vague ${bestKey})`,
      );
    } catch {
      /* ignore */
    }
  }

  // Paper pending SMC trop loin / expirés structure
  try {
    const { loadPaperTrades, savePaperTrades } = await import("./persist");
    const paper = await loadPaperTrades();
    let dirty = false;
    for (const t of paper) {
      if (t.status !== "pending" || t.strategy !== "smc") continue;
      const mid = Number(mids[t.coin] ?? mids[t.coin.toUpperCase()] ?? 0);
      if (!(mid > 0)) continue;
      const tp1 = Number(t.tp1 ?? t.tp);
      if (
        midPastTp1(t.side, mid, tp1) ||
        tooFarFromEntry(t.side, mid, t.entry, t.sl)
      ) {
        t.status = "expired";
        t.closedAt = Date.now();
        t.note = `Nettoyage : limite dépassée / trop loin (mid ${mid})`;
        dirty = true;
        notes.push(`paper ${t.coin}: pending expiré (trop loin)`);
      }
    }
    if (dirty) await savePaperTrades(paper);
  } catch (e) {
    notes.push(`paper cleanup ${e instanceof Error ? e.message : "x"}`);
  }

  return { checked, cancelled, closedJournal, notes };
}
