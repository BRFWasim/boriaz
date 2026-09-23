/**
 * Mids Hyperliquid frais — burst WebSocket puis fallback HTTP.
 * Sur Vercel serverless on ne garde pas de WS permanent : on ouvre,
 * on prend 1 tick allMids, on ferme. Plus réactif que HTTP seul
 * pour le zone-watch (fill zone ÔTE sans attendre le prochain poll lent).
 */

import {
  HttpTransport,
  InfoClient,
  SubscriptionClient,
  WebSocketTransport,
} from "@nktkas/hyperliquid";

export type MidsSnapshot = {
  mids: Record<string, string>;
  source: "ws" | "http";
  ms: number;
};

const WS_BUDGET_MS = 2_400;

function asMidsMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" || typeof v === "number") {
      out[k] = String(v);
    }
  }
  return out;
}

async function fetchMidsHttp(testnet: boolean): Promise<Record<string, string>> {
  const info = new InfoClient({
    transport: new HttpTransport({ isTestnet: testnet }),
  });
  return asMidsMap(await info.allMids());
}

/**
 * Burst WS allMids : 1er tick reçu gagne, sinon timeout → HTTP.
 */
export async function fetchFreshMids(opts?: {
  testnet?: boolean;
  preferWs?: boolean;
}): Promise<MidsSnapshot> {
  const testnet = Boolean(opts?.testnet);
  const preferWs = opts?.preferWs !== false;
  const t0 = Date.now();

  if (preferWs) {
    let transport: WebSocketTransport | null = null;
    const holder: { unsub: (() => Promise<void>) | null } = { unsub: null };
    try {
      transport = new WebSocketTransport({
        isTestnet: testnet,
        timeout: WS_BUDGET_MS,
        resubscribe: false,
      });
      await transport.ready(AbortSignal.timeout(WS_BUDGET_MS));

      const client = new SubscriptionClient({ transport });
      const mids = await new Promise<Record<string, string>>((resolve, reject) => {
        let settled = false;
        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          fn();
        };
        const timer = setTimeout(
          () => finish(() => reject(new Error("ws allMids timeout"))),
          WS_BUDGET_MS,
        );

        void client
          .allMids((evt) => {
            finish(() => resolve(asMidsMap(evt.mids)));
          })
          .then((s) => {
            holder.unsub = () => s.unsubscribe();
          })
          .catch((e) => finish(() => reject(e)));
      });

      return { mids, source: "ws", ms: Date.now() - t0 };
    } catch {
      /* fallback HTTP */
    } finally {
      try {
        await holder.unsub?.();
      } catch {
        /* ignore */
      }
      try {
        transport?.close();
      } catch {
        /* ignore */
      }
    }
  }

  const mids = await fetchMidsHttp(testnet);
  return { mids, source: "http", ms: Date.now() - t0 };
}

export function midFromSnapshot(snap: MidsSnapshot, coin: string): number {
  const raw =
    snap.mids[coin] ??
    snap.mids[coin.toUpperCase()] ??
    snap.mids[coin.toLowerCase()] ??
    "0";
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}
