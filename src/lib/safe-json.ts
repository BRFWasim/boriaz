/** Parse une réponse fetch en JSON sans planter sur du texte Vercel (504, etc.). */
export async function readResponseJson<T = unknown>(
  res: Response,
): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    const snippet = text.replace(/\s+/g, " ").trim().slice(0, 140);
    if (res.status === 504 || /FUNCTION_INVOCATION_TIMEOUT/i.test(text)) {
      throw new Error(
        "Le serveur a mis trop longtemps (timeout). Réessaie dans quelques secondes.",
      );
    }
    if (res.status >= 500) {
      throw new Error(
        `Erreur serveur ${res.status}${snippet ? ` — ${snippet}` : ""}`,
      );
    }
    throw new Error(
      snippet
        ? `Réponse non JSON (${res.status}): ${snippet}`
        : `Réponse non JSON (HTTP ${res.status})`,
    );
  }
}
