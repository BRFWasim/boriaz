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
  const posCoins = new Set(
    (portfolio.ok ? portfolio.positions : []).map((p) =>
      p.coin.toUpperCase(),
    ),
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

  // Orphan HL limits (pas de journal) : cancel reduceOnly=false sans position si mid a bougé fort
  for (const o of opens ?? []) {
    const coin = String(o.coin || "").toUpperCase();
    if (!coin || isProtectiveOpenOrder(o)) continue;
    if (posCoins.has(coin)) continue;
    const inJournal = journal.some(
      (e) => e.coin.toUpperCase() === coin && e.status === "open",
    );
    if (inJournal) continue;
    const mid = Number(mids[coin] ?? 0);
    const limitPx = Number(
      (o as { limitPx?: string | number }).limitPx ??
        (o as { px?: string | number }).px ??
        0,
    );
    if (!(mid > 0 && limitPx > 0)) continue;
    const distPct = Math.abs(mid - limitPx) / mid;
    // Limite orpheline >1.5% du mid → nettoyer
    if (distPct < 0.015) continue;
    const asset = assets.get(coin);
    if (!asset) continue;
    const oid = Number(o.oid);
    if (!Number.isFinite(oid)) continue;
    try {
      await client.cancel({ cancels: [{ a: asset.id, o: oid }] });
      cancelled += 1;
      notes.push(`${coin}: orphan limit cancel oid=${oid} dist=${(distPct * 100).toFixed(1)}%`);
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
