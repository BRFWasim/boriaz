/**
 * Runner de migrations SQL non destructives.
 * Usage: npx tsx scripts/db-migrate.ts [up|down] [steps]
 */

import { promises as fs } from "fs";
import path from "path";
import { getPgPool, closePgPool, databaseUrlConfigured } from "../src/lib/db/client";

const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");

async function listMigrations(): Promise<string[]> {
  const files = await fs.readdir(MIGRATIONS_DIR);
  return files
    .filter((f) => f.endsWith(".up.sql"))
    .map((f) => f.replace(/\.up\.sql$/, ""))
    .sort();
}

async function appliedSet(): Promise<Set<string>> {
  const pool = getPgPool();
  if (!pool) return new Set();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  const res = await pool.query<{ id: string }>("SELECT id FROM schema_migrations");
  return new Set(res.rows.map((r) => r.id));
}

export async function migrateUp(): Promise<{ applied: string[] }> {
  if (!databaseUrlConfigured()) {
    throw new Error("DATABASE_URL requis pour migrate up");
  }
  const pool = getPgPool()!;
  const applied = await appliedSet();
  const all = await listMigrations();
  const done: string[] = [];
  for (const id of all) {
    if (applied.has(id)) continue;
    const sql = await fs.readFile(
      path.join(MIGRATIONS_DIR, `${id}.up.sql`),
      "utf8",
    );
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        `INSERT INTO schema_migrations (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
        [id],
      );
      await client.query("COMMIT");
      done.push(id);
      console.log(JSON.stringify({ event: "migrate_up", id }));
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  return { applied: done };
}

export async function migrateDown(steps = 1): Promise<{ reverted: string[] }> {
  if (!databaseUrlConfigured()) {
    throw new Error("DATABASE_URL requis pour migrate down");
  }
  const pool = getPgPool()!;
  const applied = [...(await appliedSet())].sort().reverse();
  const reverted: string[] = [];
  for (const id of applied.slice(0, steps)) {
    const sql = await fs.readFile(
      path.join(MIGRATIONS_DIR, `${id}.down.sql`),
      "utf8",
    );
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(`DELETE FROM schema_migrations WHERE id = $1`, [id]);
      await client.query("COMMIT");
      reverted.push(id);
      console.log(JSON.stringify({ event: "migrate_down", id }));
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  return { reverted };
}

const cmd = (process.argv[2] || "up").toLowerCase();
if (cmd === "up" || cmd === "down") {
  (async () => {
    try {
      if (cmd === "down") console.log(await migrateDown(Number(process.argv[3] || 1)));
      else console.log(await migrateUp());
    } catch (e) {
      console.error(e);
      process.exitCode = 1;
    } finally {
      await closePgPool();
    }
  })();
}
