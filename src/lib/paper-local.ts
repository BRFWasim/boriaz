import type { PaperTrade } from "@/lib/user-types";

const KEY = "boriazbot-paper-v1";

export function readLocalPaper(): PaperTrade[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PaperTrade[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeLocalPaper(trades: PaperTrade[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(trades.slice(0, 80)));
  } catch {
    // quota
  }
}

export async function syncPaperFromBrowser(): Promise<PaperTrade[] | null> {
  const local = readLocalPaper();
  if (!local.length) return null;
  try {
    const res = await fetch("/api/paper", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trades: local }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { trades?: PaperTrade[] };
    if (json.trades) writeLocalPaper(json.trades);
    return json.trades ?? null;
  } catch {
    return null;
  }
}
