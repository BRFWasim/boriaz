/**
 * Zones armées (EN ATTENTE / pré-arm) → scan instantané quand mid entre dans la zone.
 * Burst WS allMids (hl-mids) + poll cron/zone — pas de worker WS permanent sur Vercel.
 */
import { kvGetJson, kvSetJsonEx } from "./kv";
import { isLiveSideAllowed } from "./live-side-policy";

export type ArmedZone = {
  coin: string;
  side: "long" | "short";
  zoneLow: number;
  zoneHigh: number;
  entry: number;
  tp1: number;
  sl: number;
  at: number;
  paperId?: string;
};

const KEY = "boriaz:armed-zones";
const TTL = 6 * 3600; // 6h

export async function loadArmedZones(): Promise<ArmedZone[]> {
  const raw = await kvGetJson<ArmedZone[]>(KEY);
  if (!Array.isArray(raw)) return [];
  const now = Date.now();
  return raw.filter(
    (z) =>
      z &&
      now - z.at < TTL * 1000 &&
      isLiveSideAllowed(z.side),
  );
}

export async function saveArmedZone(zone: ArmedZone): Promise<void> {
  if (!isLiveSideAllowed(zone.side)) return;
  const all = await loadArmedZones();
  const next = all.filter(
    (z) =>
      !(
        z.coin.toUpperCase() === zone.coin.toUpperCase() &&
        z.side === zone.side
      ),
  );
  next.push(zone);
  await kvSetJsonEx(KEY, next.slice(-40), TTL);
}

export async function clearArmedZone(
  coin: string,
  side: "long" | "short",
): Promise<void> {
  const all = await loadArmedZones();
  const next = all.filter(
    (z) =>
      !(
        z.coin.toUpperCase() === coin.toUpperCase() && z.side === side
      ),
  );
  await kvSetJsonEx(KEY, next, TTL);
}

/**
 * Si un mid est dans une zone armée → force un scan signaux.
 */
export async function checkArmedZonesAndScan(): Promise<{
  hit: boolean;
  coin: string | null;
  notes: string[];
  scanned: boolean;
}> {
  const notes: string[] = [];
  const zones = await loadArmedZones();
  if (!zones.length) {
    return { hit: false, coin: null, notes: ["aucune zone armée"], scanned: false };
  }

  const { getLiveConfig } = await import("./hl-live");
  const { fetchFreshMids, midFromSnapshot } = await import("./hl-mids");
  const cfg = getLiveConfig();
  const snap = await fetchFreshMids({ testnet: cfg.testnet, preferWs: true });
  notes.push(`mids ${snap.source} ${snap.ms}ms`);

  for (const z of zones) {
    const mid = midFromSnapshot(snap, z.coin);
    if (!(mid > 0)) continue;
    const inZone = mid >= z.zoneLow * 0.994 && mid <= z.zoneHigh * 1.006;
    const pastTp1 = z.side === "long" ? mid >= z.tp1 : mid <= z.tp1;
    if (pastTp1) {
      await clearArmedZone(z.coin, z.side);
      notes.push(`${z.coin}: zone armée clear (mid ≥ TP1)`);
      continue;
    }
    if (!inZone) continue;
    notes.push(
      `${z.coin}: MID EN ZONE ${mid} ∈ [${z.zoneLow},${z.zoneHigh}] via ${snap.source} → scan force`,
    );
    try {
      const { getTradeSignals } = await import("./trade-signal");
      await getTradeSignals({ notify: true, force: true });
      await clearArmedZone(z.coin, z.side);
      return { hit: true, coin: z.coin, notes, scanned: true };
    } catch (e) {
      notes.push(`scan err ${e instanceof Error ? e.message : "x"}`);
      return { hit: true, coin: z.coin, notes, scanned: false };
    }
  }
  return { hit: false, coin: null, notes, scanned: false };
}
