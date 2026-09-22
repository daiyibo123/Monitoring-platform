import type { Env } from "./types";

// Idempotent schema DDL, mirrors migrations/0001_init.sql. Run at runtime so
// the app works whether or not the operator applied the migration, and so it
// is resilient to Cloudflare's local-dev D1 persistence keying. Guarded by a
// per-isolate flag so it costs one batch only on cold start.
const DDL = [
  `CREATE TABLE IF NOT EXISTS sites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'newapi',
    note TEXT NOT NULL DEFAULT '',
    access_token TEXT NOT NULL DEFAULT '',
    sort INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id INTEGER NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    group_name TEXT NOT NULL DEFAULT '',
    api_key TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_api_keys_site ON api_keys(site_id)`,
  `CREATE TABLE IF NOT EXISTS key_status (
    key_id INTEGER PRIMARY KEY,
    alive INTEGER,
    latency_ms INTEGER,
    http_status INTEGER,
    error TEXT,
    group_ratio REAL,
    model_ratios TEXT,
    models TEXT,
    balance_usd REAL,
    total_usage_usd REAL,
    balance_raw TEXT,
    pricing_source TEXT,
    tested_at INTEGER,
    FOREIGN KEY (key_id) REFERENCES api_keys(id) ON DELETE CASCADE
  )`,
];

// Columns added after the initial release. `CREATE TABLE IF NOT EXISTS` never
// alters an existing table, so a DB provisioned before a column existed needs an
// explicit, idempotent ALTER. We check PRAGMA table_info first because D1/SQLite
// has no `ADD COLUMN IF NOT EXISTS`, and a duplicate-column ALTER throws.
async function ensureColumn(env: Env, table: string, column: string, ddl: string): Promise<void> {
  const info = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  const exists = (info.results ?? []).some((c) => c.name === column);
  if (!exists) {
    await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${ddl}`).run();
  }
}

let ready = false;

export async function ensureSchema(env: Env): Promise<void> {
  if (ready) return;
  // Run each statement individually rather than via batch(): D1 wraps a batch
  // in a single implicit transaction, and DDL inside that transaction does not
  // reliably commit on local miniflare D1 (statements "succeed" but tables are
  // never created). Sequential .run() persists correctly on both local & remote.
  for (const sql of DDL) {
    await env.DB.prepare(sql).run();
  }
  // Backfill columns onto tables that predate them (see ensureColumn).
  await ensureColumn(env, "sites", "access_token", "access_token TEXT NOT NULL DEFAULT ''");
  // Only latch after we can confirm the core table exists, so a partial/failed
  // provision doesn't get permanently skipped by the guard on later requests.
  const check = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='sites'",
  ).first();
  if (check) ready = true;
}
