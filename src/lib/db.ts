import fs from "node:fs";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";

/**
 * One tiny database interface with two backends:
 *  - DATABASE_URL set  -> real Postgres via `pg` (required in production)
 *  - otherwise         -> PGlite, a real Postgres engine that runs in-process (local dev + tests)
 * Both speak the same SQL, so exclusion constraints and transactions behave identically.
 */
export type Row = Record<string, any>;
export interface Q {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** Run several statements at once (migrations). No parameters. */
  exec(sql: string): Promise<void>;
}
export interface Db extends Q {
  tx<T>(fn: (q: Q) => Promise<T>): Promise<T>;
  kind: "pg" | "pglite";
}

const g = globalThis as unknown as { __xeDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  if (!g.__xeDb) g.__xeDb = openDb().then(async (d) => (await migrate(d), d));
  return g.__xeDb;
}

/** For tests: swap in a fresh in-memory database. */
export async function useFreshTestDb(): Promise<Db> {
  const d = await openPglite(undefined);
  await migrate(d);
  g.__xeDb = Promise.resolve(d);
  return d;
}

async function openDb(): Promise<Db> {
  if (process.env.DATABASE_URL) {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8 });
    const db: Db = {
      kind: "pg",
      query: (sql, params) => pool.query(sql, params as any[]) as any,
      exec: async (sql) => { await pool.query(sql); },
      async tx(fn) {
        const c = await pool.connect();
        try {
          await c.query("begin");
          const r = await fn({ query: (s, p) => c.query(s, p as any[]) as any, exec: async (s) => { await c.query(s); } });
          await c.query("commit");
          return r;
        } catch (e) {
          await c.query("rollback").catch(() => {});
          throw e;
        } finally {
          c.release();
        }
      },
    };
    return db;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL is required in production. The built-in local database is for development only.");
  }
  const dir = path.join(process.cwd(), ".data", "pglite");
  fs.mkdirSync(dir, { recursive: true });
  return openPglite(dir);
}

async function openPglite(dir: string | undefined): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const lite: PGlite = dir ? new PGlite(dir) : new PGlite();
  await lite.waitReady;
  return {
    kind: "pglite",
    query: (sql, params) => lite.query(sql, params as any[]) as any,
    exec: async (sql) => { await lite.exec(sql); },
    tx: (fn) => lite.transaction((t) => fn({ query: (s, p) => t.query(s, p as any[]) as any, exec: async (s) => { await t.exec(s); } })),
  };
}

async function migrate(db: Db) {
  await db.query(`create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())`);
  const dir = path.join(process.cwd(), "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const done = new Set((await db.query<{ name: string }>(`select name from _migrations`)).rows.map((r) => r.name));
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), "utf8");
    await db.tx(async (q) => {
      await q.exec(sql);
      await q.query(`insert into _migrations(name) values ($1)`, [f]);
    });
  }
}

/** Postgres unique/exclusion violation helpers. */
export const isOverlapError = (e: unknown) => (e as any)?.code === "23P01";
export const isUniqueError = (e: unknown) => (e as any)?.code === "23505";
