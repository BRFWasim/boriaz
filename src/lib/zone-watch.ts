/**
 * Zones armées (EN ATTENTE / pré-arm) → scan instantané quand mid entre dans la zone.
 * Remplace un vrai WS worker sur Vercel : poll léger à chaque manage + cron dédié.
 */
import { kvGetJson, kvSetJsonEx } from "./kv";

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
  return raw.filter((z) => z && now - z.at < TTL * 1000);
}

export async function saveArmedZone(zone: ArmedZone): Promise<void> {
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

  const { InfoClient } = await import("@nktkas/hyperliquid");
  const { makeTransport, getLiveConfig } = await import("./hl-live");
  const cfg = getLiveConfig();
  const info = new InfoClient({ transport: makeTransport(cfg.testnet) });
  const mids = await info.allMids();

  for (const z of zones) {
    const mid = Number(mids[z.coin] ?? mids[z.coin.toUpperCase()] ?? 0);
    if (!(mid > 0)) continue;
    const inZone = mid >= z.zoneLow * 0.994 && mid <= z.zoneHigh * 1.006;
    const pastTp1 = z.side === "long" ? mid >= z.tp1 : mid <= z.tp1;
    if (pastTp1) {
      await clearArmedZone(z.coin, z.side);
      notes.push(`${z.coin}: zone armée clear (mid ≥ TP1)`);
      continue;
    }
    if (!inZone) continue;
    notes.push(`${z.coin}: MID EN ZONE ${mid} ∈ [${z.zoneLow},${z.zoneHigh}] → scan force`);
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
