import { getWhaleDashboard } from "./dashboard";
import { isQualityWhale } from "./crowd-flow";
import {
  followWallet,
  loadFollowedWallets,
  loadWalletSnap,
  saveWalletSnap,
  type FollowedWallet,
} from "./persist";
import { sendTelegramMessage } from "./telegram";
import type { Whale } from "./types";

function posKey(whale: Whale): string[] {
  return whale.positions
    .map(
      (p) =>
        `${p.coin}:${p.side}:${Math.round(p.entryPx)}:${Math.round(p.notionalUsd / 1000)}k`,
    )
    .sort();
}

/** Suit automatiquement les wallets qualité (WR) du scan. */
export async function autoFollowQualityWallets(
  whales: Whale[],
  max = 25,
): Promise<FollowedWallet[]> {
  const quality = whales.filter(isQualityWhale).slice(0, max);
  let list = await loadFollowedWallets();
  for (const w of quality) {
    list = await followWallet(w.address, w.alias, "auto-quality");
  }
  return list;
}

/**
 * Compare les positions des wallets suivis vs dernier snapshot.
 * Envoie Telegram sur ouverture / fermeture / flip.
 */
export async function trackFollowedWallets(opts?: {
  notify?: boolean;
  autoFollow?: boolean;
}): Promise<{
  followed: number;
  changes: string[];
  telegramSent: boolean;
  telegramError: string | null;
}> {
  const dash = await getWhaleDashboard();
  if (opts?.autoFollow !== false) {
    await autoFollowQualityWallets(dash.whales);
  }

  const followed = await loadFollowedWallets();
  const byAddr = new Map(
    dash.whales.map((w) => [w.address.toLowerCase(), w] as const),
  );
  const prev = await loadWalletSnap();
  const next: typeof prev = { ...prev };
  const changes: string[] = [];

  for (const f of followed) {
    const whale = byAddr.get(f.address);
    if (!whale) continue;
    const keys = posKey(whale);
    const before = prev[f.address]?.positions ?? [];
    const opened = keys.filter((k) => !before.includes(k));
    const closed = before.filter((k) => !keys.includes(k));
    if (opened.length || closed.length) {
      const alias = whale.alias || f.alias;
      if (opened.length) {
        changes.push(
          `🟢 ${alias} ouvre · ${opened.slice(0, 3).join(" · ")}`,
        );
      }
      if (closed.length) {
        changes.push(
          `🔴 ${alias} ferme · ${closed.slice(0, 3).join(" · ")}`,
        );
      }
    }
    next[f.address] = {
      alias: whale.alias || f.alias,
      positions: keys,
      at: Date.now(),
    };
  }

  await saveWalletSnap(next);

  let telegramSent = false;
  let telegramError: string | null = null;
  if (opts?.notify !== false && changes.length) {
    const res = await sendTelegramMessage(
      [
        "TRACKING WALLETS",
        ...changes.slice(0, 8),
        "",
        `${followed.length} wallets suivis · Pas un conseil financier.`,
      ].join("\n"),
    );
    telegramSent = res.ok;
    telegramError = res.error ?? null;
  }

  return {
    followed: followed.length,
    changes,
    telegramSent,
    telegramError,
  };
}
