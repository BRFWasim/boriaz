import { fetchCandleSnapshot } from "@/lib/hyperliquid";
import { parseNum } from "@/lib/format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const ALLOWED = new Set(["1m", "5m", "15m", "30m", "1h", "4h", "1d"]);

type CacheEntry = {
  at: number;
  payload: {
    coin: string;
    interval: string;
    candles: { t: number; o: number; h: number; l: number; c: number }[];
  };
};

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 45_000;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const coin = (url.searchParams.get("coin") || "BTC").trim();
    const intervalRaw = (url.searchParams.get("interval") || "15m").trim();
    const interval = ALLOWED.has(intervalRaw) ? intervalRaw : "15m";
    const now = Date.now();
    const from = Number(url.searchParams.get("from") || now - 36 * 3600_000);
    const to = Number(url.searchParams.get("to") || now);
    const startTime = Number.isFinite(from) ? from : now - 36 * 3600_000;
    const endTime = Number.isFinite(to) ? to : now;

    const key = `${coin}|${interval}|${Math.floor(startTime / 60_000)}|${Math.floor(endTime / 60_000)}`;
    const hit = cache.get(key);
    if (hit && now - hit.at < CACHE_TTL_MS) {
      return Response.json(hit.payload);
    }

    const raw = await fetchCandleSnapshot({
      coin,
      interval,
      startTime,
      endTime,
    });
    const candles = raw
      .map((c) => ({
        t: c.t,
        o: parseNum(c.o),
        h: parseNum(c.h),
        l: parseNum(c.l),
        c: parseNum(c.c),
      }))
      .filter((c) => c.c > 0 && Number.isFinite(c.t))
      .sort((a, b) => a.t - b.t);

    const payload = { coin, interval, candles };
    cache.set(key, { at: now, payload });
    if (cache.size > 80) {
      const first = cache.keys().next().value;
      if (first) cache.delete(first);
    }
    return Response.json(payload);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Bougies indisponibles";
    return Response.json({ error: message, candles: [] }, { status: 502 });
  }
}
