import path from "path";
import { promises as fs } from "fs";

/**
 * Sur Vercel / Lambda le FS du projet est en lecture seule (EROFS).
 * On écrit dans /tmp (éphémère entre cold starts, OK pour paper/prefs court terme).
 * En local : répertoire du projet.
 */
export function dataDir(): string {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return "/tmp/boriazbot-data";
  }
  return process.cwd();
}

export function dataPath(filename: string): string {
  return path.join(dataDir(), filename);
}

export async function ensureDataDir(): Promise<void> {
  try {
    await fs.mkdir(dataDir(), { recursive: true });
  } catch {
    // ignore
  }
}
