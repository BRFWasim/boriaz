/**
 * Protections LIVE : SL trop serrés, cooldown post-stop, pas de re-entry suicide.
 */
import {
  getExchangeClient,
  getLiveConfig,
  isLiveEnvReady,
  isProtectiveOpenOrder,
  loadAssetMap,
  makeTransport,
  forceReplaceLiveTpsl,
  fetchLivePortfolio,
} from "./hl-live";
import { InfoClient } from "@nktkas/hyperliquid";
import { minSlDistancePct } from "./smc";

const STOPOUT_COIN_COOLDOWN_MS = 2 * 60 * 60_000; // 2h après stop
const STOPOUT_GLOBAL_COOLDOWN_MS = 10 * 60_000;

function coinStopKey(coin: string) {
  return `boriaz:live-stopout:${coin.toUpperCase()}`;
}
const GLOBAL_STOP_KEY = "boriaz:live-stopout:global";

export async function noteLiveStopOut(coin: string): Promise<void> {
  const now = Date.now();
  const { setDurableCooldown } = await import("./arch-guards");
  await setDurableCooldown(
    coinStopKey(coin),
    now,
    Math.ceil(STOPOUT_COIN_COOLDOWN_MS / 1000) + 60,
  );
  await setDurableCooldown(
    GLOBAL_STOP_KEY,
    now,
    Math.ceil(STOPOUT_GLOBAL_COOLDOWN_MS / 1000) + 60,
  );
  // Annuler toute limite d’entrée restante sur ce coin (anti fill immédiat)
  try {
    const ready = isLiveEnvReady();
    if (!ready.ok) return;
    const cfg = getLiveConfig();
    if (!cfg.accountAddress) return;
    const info = new InfoClient({ transport: makeTransport(cfg.testnet) });
    const opens = await info.frontendOpenOrders({
      user: cfg.accountAddress as `0x${string}`,
    });
    const assets = await loadAssetMap(cfg.testnet);
    const asset = assets.get(coin.toUpperCase());
    if (!asset) return;
    const client = getExchangeClient(cfg.testnet);
    const cancels = (opens ?? [])
      .filter(
        (o) =>
          String(o.coin || "").toUpperCase() === coin.toUpperCase() &&
          !isProtectiveOpenOrder(o),
      )
      .map((o) => ({ a: asset.id, o: Number(o.oid) }))
      .filter((c) => Number.isFinite(c.o));
    if (cancels.length) await client.cancel({ cancels });
  } catch {
    /* best-effort */
  }
}

export async function isInStopOutCooldown(coin: string): Promise<{
  blocked: boolean;
  reason?: string;
}> {
  const { getDurableCooldown } = await import("./arch-guards");
  const now = Date.now();
  const g = await getDurableCooldown(GLOBAL_STOP_KEY);
  if (g > 0 && now - g < STOPOUT_GLOBAL_COOLDOWN_MS) {
    const wait = Math.ceil((STOPOUT_GLOBAL_COOLDOWN_MS - (now - g)) / 1000);
    return { blocked: true, reason: `Cooldown post-stop global encore ${wait}s` };
  }
  const c = await getDurableCooldown(coinStopKey(coin));
  if (c > 0 && now - c < STOPOUT_COIN_COOLDOWN_MS) {
    const wait = Math.ceil((STOPOUT_COIN_COOLDOWN_MS - (now - c)) / 60000);
    return {
      blocked: true,
      reason: `Cooldown post-stop ${coin.toUpperCase()} encore ~${wait} min — pas de revenge trade`,
    };
  }
  return { blocked: false };
}

/**
 * Si SL ouvert < distance min → élargir (garder TP). Sauve du noise-stop.
 */
export async function widenTightLiveStops(): Promise<{
  checked: number;
  widened: number;
  notes: string[];
}> {
  const notes: string[] = [];
  let checked = 0;
  let widened = 0;
  const ready = isLiveEnvReady();
  if (!ready.ok) return { checked: 0, widened: 0, notes: [ready.reason || "env"] };

  const portfolio = await fetchLivePortfolio();
  if (!portfolio.ok || !portfolio.positions.length) {
    return { checked: 0, widened: 0, notes: [] };
  }
  const cfg = getLiveConfig();
  const info = new InfoClient({ transport: makeTransport(cfg.testnet) });
  const opens = await info.frontendOpenOrders({
    user: cfg.accountAddress as `0x${string}`,
  });

  for (const pos of portfolio.positions) {
    checked += 1;
    const entry = pos.entryPx;
    if (!(entry > 0)) continue;
    const minPct = minSlDistancePct(entry);
    const forCoin = (opens ?? []).filter(
      (o) => String(o.coin || "").toUpperCase() === pos.coin.toUpperCase(),
    );
    const slOrder = forCoin.find((o) => {
      const ot = String(o.orderType || "");
      return /stop/i.test(ot) && !/take\s*profit/i.test(ot);
    });
    if (!slOrder) continue;
    const slPx = Number(
      (slOrder as { triggerPx?: string | number }).triggerPx ??
        slOrder.limitPx ??
        0,
    );
    if (!(slPx > 0)) continue;
    const dist =
      pos.side === "long" ? (entry - slPx) / entry : (slPx - entry) / entry;
    if (dist >= minPct * 0.95) continue;

    const newSl =
      pos.side === "long" ? entry * (1 - minPct) : entry * (1 + minPct);
    // Garder le meilleur TP existant (plus loin)
    const tps = forCoin
      .filter((o) => /take\s*profit/i.test(String(o.orderType || "")))
      .map((o) =>
        Number(
          (o as { triggerPx?: string | number }).triggerPx ?? o.limitPx ?? 0,
        ),
      )
      .filter((x) => x > 0);
    let tp = tps.length
      ? pos.side === "long"
        ? Math.max(...tps)
        : Math.min(...tps)
      : pos.side === "long"
        ? entry * (1 + minPct * 2)
        : entry * (1 - minPct * 2);

    try {
      const res = await forceReplaceLiveTpsl({
        coin: pos.coin,
        side: pos.side,
        sl: newSl,
        tp,
      });
      if (res.ok) {
        widened += 1;
        notes.push(
          `${pos.coin}: SL élargi ${(dist * 100).toFixed(2)}% → ${(minPct * 100).toFixed(2)}% (${slPx}→${newSl.toFixed(6)})`,
        );
      } else {
        notes.push(`${pos.coin}: widen fail ${res.reason || "?"}`);
      }
    } catch (e) {
      notes.push(
        `${pos.coin}: widen err ${e instanceof Error ? e.message : "x"}`,
      );
    }
  }
  return { checked, widened, notes };
}

/**
 * Journal open sans position + fill Close Short/Long récent via Stop → stop-out.
 */
export async function detectStopOutsAndArmCooldown(): Promise<{
  found: number;
  notes: string[];
}> {
  const notes: string[] = [];
  let found = 0;
  const ready = isLiveEnvReady();
  if (!ready.ok) return { found: 0, notes: [] };
  const cfg = getLiveConfig();
  if (!cfg.accountAddress) return { found: 0, notes: [] };

  const { loadLiveJournal, updateLiveJournalEntry } = await import(
    "./live-journal"
  );
  const journal = (await loadLiveJournal()).filter((e) => e.status === "open");
  if (!journal.length) return { found: 0, notes: [] };

  const portfolio = await fetchLivePortfolio();
  const posKeys = new Set(
    (portfolio.ok ? portfolio.positions : []).map(
      (p) => `${p.coin.toUpperCase()}:${p.side}`,
    ),
  );

  const { postInfo } = await import("./hyperliquid");
  const fills = (await postInfo({
    type: "userFills",
    user: cfg.accountAddress,
  }).catch(() => [])) as Array<{
    coin?: string;
    time?: number;
    dir?: string;
    closedPnl?: string | number;
  }>;

  const now = Date.now();
  for (const entry of journal) {
    const key = `${entry.coin.toUpperCase()}:${entry.side}`;
    if (posKeys.has(key)) continue;
    const recent = fills
      .filter(
        (f) =>
          String(f.coin || "").toUpperCase() === entry.coin.toUpperCase() &&
          String(f.dir || "").toLowerCase().includes("close") &&
          Number(f.time || 0) > now - 30 * 60_000,
      )
      .sort((a, b) => Number(b.time || 0) - Number(a.time || 0))[0];
    if (!recent) {
      // Flat sans fill récent : fermer journal quand même
      await updateLiveJournalEntry(entry.id, {
        status: "closed",
        closedAt: now,
      });
      notes.push(`${entry.coin}: journal fermé (plus de position)`);
      continue;
    }
    found += 1;
    await noteLiveStopOut(entry.coin);
    await updateLiveJournalEntry(entry.id, {
      status: "closed",
      closedAt: Number(recent.time) || now,
    });
    const pnl = Number(recent.closedPnl ?? 0);
    notes.push(
      `${entry.coin}: STOP-OUT détecté pnl=${pnl.toFixed(2)}$ → cooldown 2h`,
    );
  }
  return { found, notes };
}
