/**
 * Client PostgreSQL lazy (Node runtime only — jamais importer depuis middleware Edge).
 * DATABASE_URL absente → null (mode dégradé / Vercel sans PG).
 */

import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

let pool: Pool | null = null;
let lastError: string | null = null;

export function databaseUrlConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getPgPool(): Pool | null {
  if (!databaseUrlConfigured()) return null;
  if (pool) return pool;
  pool = new Pool({
    connectionString: process.env.DATABASE_URL!.trim(),
    max: Number(process.env.PG_POOL_MAX || 5),
    idleTimeoutMillis: 20_000,
    connectionTimeoutMillis: 8_000,
    ssl:
      process.env.PG_SSL === "false"
        ? undefined
        : process.env.DATABASE_URL!.includes("localhost")
          ? undefined
          : { rejectUnauthorized: process.env.PG_SSL_REJECT_UNAUTHORIZED !== "false" },
  });
  pool.on("error", (err) => {
    lastError = err.message;
    console.error(JSON.stringify({ service: "postgres", event: "pool_error", message: err.message }));
  });
  return pool;
}

export async function pgQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T> | null> {
  const p = getPgPool();
  if (!p) return null;
  try {
    return await p.query<T>(text, params);
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    throw e;
  }
}

export async function withPgClient<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T | null> {
  const p = getPgPool();
  if (!p) return null;
  const client = await p.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function postgresHealth(): Promise<{
  ok: boolean;
  configured: boolean;
  latencyMs: number | null;
  error: string | null;
}> {
  if (!databaseUrlConfigured()) {
    return { ok: false, configured: false, latencyMs: null, error: "DATABASE_URL absent" };
  }
  const t0 = Date.now();
  try {
    const res = await pgQuery("SELECT 1 AS ok");
    return {
      ok: Boolean(res?.rows?.[0]),
      configured: true,
      latencyMs: Date.now() - t0,
      error: null,
    };
  } catch (e) {
    return {
      ok: false,
      configured: true,
      latencyMs: Date.now() - t0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export function getLastPgError(): string | null {
  return lastError;
}

export async function closePgPool(): Promise<void> {
  if (!pool) return;
  await pool.end();
  pool = null;
}
