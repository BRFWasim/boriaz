/**
 * Stockage persistant : Upstash Redis REST si configuré, sinon fichier /tmp + mémoire.
 * Sur Vercel sans Upstash, /tmp est effacé à froid — paper/journal ne survivent pas.
 *
 * Circuit-breaker : si Upstash renvoie « max requests limit », on stoppe les appels
 * REST ~1h (mémoire process only) pour ne pas brûler le quota restant / spam.
 */

const mem = new Map<string, string>();

let upstashDownUntil = 0;
let lastUpstashError: string | null = null;

function upstashConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() &&
      process.env.UPSTASH_REDIS_REST_TOKEN?.trim(),
  );
}

function upstashUsable(): boolean {
  return upstashConfigured() && Date.now() >= upstashDownUntil;
}

export function kvBackend(): "upstash" | "tmp" {
  return upstashConfigured() ? "upstash" : "tmp";
}

/** Santé storage pour /api/status + UI. */
export function kvHealth(): {
  backend: "upstash" | "tmp";
  ok: boolean;
  error: string | null;
  downUntil: number | null;
} {
  if (!upstashConfigured()) {
    return { backend: "tmp", ok: false, error: "UPSTASH non configuré", downUntil: null };
  }
  if (Date.now() < upstashDownUntil) {
    return {
      backend: "upstash",
      ok: false,
      error:
        lastUpstashError ||
        "Upstash indisponible (quota / erreur) — paper non durable",
      downUntil: upstashDownUntil,
    };
  }
  return { backend: "upstash", ok: true, error: null, downUntil: null };
}

function markUpstashDown(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err || "upstash");
  lastUpstashError = msg;
  // Quota mensuel : pause longue. Autre erreur : pause courte.
  const quota = /max requests limit|quota|limit exceeded/i.test(msg);
  upstashDownUntil = Date.now() + (quota ? 6 * 3600_000 : 120_000);
}

async function upstashCommand(args: unknown[]): Promise<unknown> {
  if (!upstashUsable()) {
    throw new Error(lastUpstashError || "Upstash circuit-open");
  }
  const url = process.env.UPSTASH_REDIS_REST_URL!.trim().replace(/\/$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN!.trim();
  const res = await fetch(`${url}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const json = (await res.json()) as { result?: unknown; error?: string };
  if (!res.ok || json.error) {
    const err = new Error(json.error || `Upstash HTTP ${res.status}`);
    markUpstashDown(err);
    throw err;
  }
  return json.result;
}

/** Probe GET ping — pour status. */
export async function kvProbe(): Promise<{
  ok: boolean;
  error: string | null;
}> {
  if (!upstashConfigured()) {
    return { ok: false, error: "UPSTASH non configuré" };
  }
  if (!upstashUsable()) {
    return {
      ok: false,
      error: lastUpstashError || "circuit-open",
    };
  }
  try {
    await upstashCommand(["PING"]);
    lastUpstashError = null;
    return { ok: true, error: null };
  } catch (e) {
    markUpstashDown(e);
    return {
      ok: false,
      error: e instanceof Error ? e.message : "probe-failed",
    };
  }
}

export async function kvGet(key: string): Promise<string | null> {
  if (upstashUsable()) {
    try {
      const result = await upstashCommand(["GET", key]);
      if (result == null) return mem.get(key) ?? null;
      const str = typeof result === "string" ? result : String(result);
      mem.set(key, str);
      return str;
    } catch {
      return mem.get(key) ?? null;
    }
  }
  return mem.get(key) ?? null;
}

export async function kvSet(key: string, value: string): Promise<void> {
  mem.set(key, value);
  if (!upstashUsable()) return;
  try {
    await upstashCommand(["SET", key, value]);
  } catch {
    // mémoire déjà à jour
  }
}

/** SET avec TTL (secondes). Sans Upstash : mémoire process seulement. */
export async function kvSetEx(
  key: string,
  value: string,
  ttlSec: number,
): Promise<void> {
  mem.set(key, value);
  if (!upstashUsable()) return;
  try {
    await upstashCommand([
      "SET",
      key,
      value,
      "EX",
      Math.max(1, Math.floor(ttlSec)),
    ]);
  } catch {
    // mémoire déjà à jour
  }
}

export async function kvSetJsonEx(
  key: string,
  value: unknown,
  ttlSec: number,
): Promise<void> {
  await kvSetEx(key, JSON.stringify(value), ttlSec);
}

export async function kvGetJson<T>(key: string): Promise<T | null> {
  const raw = await kvGet(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function kvSetJson(key: string, value: unknown): Promise<void> {
  await kvSet(key, JSON.stringify(value));
}

export async function kvDel(key: string): Promise<void> {
  mem.delete(key);
  if (!upstashUsable()) return;
  try {
    await upstashCommand(["DEL", key]);
  } catch {
    /* ignore */
  }
}

/**
 * SET key NX EX ttl — lock distribué (Upstash) ou mémoire process.
 * Retourne true si le lock a été acquis.
 */
export async function kvSetNxEx(
  key: string,
  value: string,
  ttlSec: number,
): Promise<boolean> {
  const ttl = Math.max(1, Math.floor(ttlSec));
  if (upstashUsable()) {
    try {
      const result = await upstashCommand([
        "SET",
        key,
        value,
        "EX",
        ttl,
        "NX",
      ]);
      const ok = result === "OK" || result === true;
      if (ok) mem.set(key, value);
      return ok;
    } catch {
      // fallback mémoire si Upstash down
    }
  }
  if (mem.has(key)) return false;
  mem.set(key, value);
  // TTL approximatif en mémoire
  setTimeout(() => {
    if (mem.get(key) === value) mem.delete(key);
  }, ttl * 1000).unref?.();
  return true;
}
