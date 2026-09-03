import { getMacroCalendar } from "./macro";
import {
  inHushHours,
  loadMacroAlertKeys,
  loadPrefs,
  saveMacroAlertKeys,
} from "./persist";
import { sendTelegramMessage } from "./telegram";

const WINDOW_MS = 30 * 60_000;
const TOLERANCE_MS = 8 * 60_000; // fenêtre de détection cron

/**
 * Alerte Telegram T−30 min avant événements High impact (USD prioritaire).
 */
export async function runMacroT30Alerts(): Promise<{
  checked: number;
  sent: number;
  skipped: string[];
  error: string | null;
}> {
  const prefs = await loadPrefs();
  if (!prefs.telegramEnabled) {
    return { checked: 0, sent: 0, skipped: ["telegram désactivé"], error: null };
  }
  if (inHushHours(prefs)) {
    return { checked: 0, sent: 0, skipped: ["hush hours"], error: null };
  }

  const cal = await getMacroCalendar();
  const now = Date.now();
  const keys = await loadMacroAlertKeys();
  let sent = 0;
  const skipped: string[] = [];
  let error: string | null = null;

  const high = cal.events.filter(
    (e) =>
      e.impact === "High" &&
      (e.country === "USD" || e.country === "EUR" || e.country === "All"),
  );

  for (const ev of high) {
    const t = new Date(ev.at).getTime();
    if (!Number.isFinite(t)) continue;
    const delta = t - now;
    // Dans la fenêtre [T−30 − tol, T−30 + tol]
    if (delta > WINDOW_MS + TOLERANCE_MS || delta < WINDOW_MS - TOLERANCE_MS) {
      continue;
    }
    const key = `t30:${ev.id}`;
    if (keys.has(key)) {
      skipped.push(`déjà envoyé ${ev.title}`);
      continue;
    }

    const mins = Math.round(delta / 60_000);
    const text = [
      `⏰ MACRO HIGH · T−${mins} min`,
      `${ev.country} · ${ev.title}`,
      `Heure: ${new Date(ev.at).toISOString()}`,
      ev.forecast ? `Forecast: ${ev.forecast}` : "",
      ev.previous ? `Previous: ${ev.previous}` : "",
      "",
      ev.prediction,
      ev.marketEffect,
      "",
      "Réduire le levier / éviter d’ouvrir juste avant si tu es exposé.",
      "Pas un conseil financier.",
    ]
      .filter(Boolean)
      .join("\n");

    const res = await sendTelegramMessage(text);
    if (res.ok) {
      keys.add(key);
      sent += 1;
    } else {
      error = res.error ?? "Telegram échec";
    }
  }

  await saveMacroAlertKeys(keys);
  return { checked: high.length, sent, skipped, error };
}
