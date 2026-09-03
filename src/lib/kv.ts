/**
 * Stockage persistant : Upstash Redis REST si configuré, sinon fichier /tmp + mémoire.
 * Sur Vercel sans Upstash, /tmp est effacé à froid — paper/journal ne survivent pas.
 */

const mem = new Map<string, string>();

function upstashConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() &&
      process.env.UPSTASH_REDIS_REST_TOKEN?.trim(),
  );
}

export function kvBackend(): "upstash" | "tmp" {
  return upstashConfigured() ? "upstash" : "tmp";
}

async function upstashCommand(args: unknown[]): Promise<unknown> {
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
    throw new Error(json.error || `Upstash HTTP ${res.status}`);
  }
  return json.result;
}

export async function kvGet(key: string): Promise<string | null> {
  if (upstashConfigured()) {
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
  if (!upstashConfigured()) return;
  try {
    await upstashCommand(["SET", key, value]);
  } catch {
    // mémoire déjà à jour
  }
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
