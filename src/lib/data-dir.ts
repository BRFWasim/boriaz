/**
 * Stockage writable. Sur Vercel/Lambda `/var/task` est read-only (EROFS).
 * On n’utilise JAMAIS process.cwd() pour les écritures en prod / serverless.
 * Chemins littéraux pour éviter le tracing Turbopack de tout le projet.
 */

const TMP_DIR = "/tmp/boriazbot-data";

function isServerlessFs(): boolean {
  const cwd = (() => {
    try {
      return process.cwd();
    } catch {
      return "";
    }
  })();
  return (
    process.env.VERCEL === "1" ||
    process.env.VERCEL === "true" ||
    Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) ||
    process.env.NODE_ENV === "production" ||
    cwd === "/var/task" ||
    cwd.startsWith("/var/task")
  );
}

export function dataDir(): string {
  if (isServerlessFs()) return TMP_DIR;
  // Dev local uniquement
  return TMP_DIR; // aussi /tmp en local pour un comportement identique et éviter EROFS surprises
}

export function dataPath(filename: string): string {
  const name = filename.replace(/^\/+/, "");
  return `${dataDir()}/${name}`;
}

export async function ensureDataDir(): Promise<void> {
  const { promises: fs } = await import("fs");
  try {
    await fs.mkdir(dataDir(), { recursive: true });
  } catch {
    // ignore
  }
}
