import type { Env } from "./types";

// Idempotent schema DDL, mirrors migrations/0001_init.sql. Run at runtime so
// the app works whether or not the operator applied the migration, and so it
// is resilient to Cloudflare's local-dev D1 persistence keying. Guarded by a
// per-isolate flag so it costs one pass only on cold start.
const DDL = [
  `CREATE TABLE IF NOT EXISTS sites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'newapi',
    note TEXT NOT NULL DEFAULT '',
    access_token TEXT NOT NULL DEFAULT '',
    newapi_user_id TEXT NOT NULL DEFAULT '',
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
    auto_claimed_at INTEGER,
    FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_api_keys_site ON api_keys(site_id)`,
  `CREATE TABLE IF NOT EXISTS key_status (
    key_id INTEGER PRIMARY KEY,
    state TEXT,
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
    probe TEXT,
    tested_at INTEGER,
    FOREIGN KEY (key_id) REFERENCES api_keys(id) ON DELETE CASCADE
  )`,
  // Account balance is site-level (one site = one upstream account).
  `CREATE TABLE IF NOT EXISTS site_status (
    site_id INTEGER PRIMARY KEY,
    balance_usd REAL,
    total_usage_usd REAL,
    unlimited INTEGER NOT NULL DEFAULT 0,
    source TEXT,
    error TEXT,
    checked_at INTEGER,
    ok_at INTEGER,
    FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
  )`,
  // Failed password attempts per client IP (lib/ratelimit.ts).
  `CREATE TABLE IF NOT EXISTS auth_failures (
    bucket TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0,
    window_start INTEGER NOT NULL
  )`,
];

// Columns added after the initial release. `CREATE TABLE IF NOT EXISTS` never
// alters an existing table, so older databases get an explicit, idempotent
// ALTER (D1/SQLite has no `ADD COLUMN IF NOT EXISTS`).
const COLUMNS: Record<string, Array<[string, string]>> = {
  sites: [
    ["access_token", "access_token TEXT NOT NULL DEFAULT ''"],
    ["newapi_user_id", "newapi_user_id TEXT NOT NULL DEFAULT ''"],
  ],
  api_keys: [["auto_claimed_at", "auto_claimed_at INTEGER"]],
  key_status: [
    ["state", "state TEXT"],
    ["probe", "probe TEXT"],
  ],
};

async function ensureColumns(env: Env, table: string, cols: Array<[string, string]>): Promise<void> {
  const info = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  const have = new Set((info.results ?? []).map((c) => c.name));
  for (const [name, ddl] of cols) {
    if (!have.has(name)) await env.DB.prepare(`ALTER TABLE ${table} ADD COLUMN ${ddl}`).run();
  }
}

let ready = false;

export async function ensureSchema(env: Env): Promise<void> {
  if (ready) return;
  // Run each statement individually rather than via batch(): D1 wraps a batch
  // in a single implicit transaction, and DDL inside that transaction does not
  // reliably commit on local miniflare D1. Sequential .run() persists on both.
  for (const sql of DDL) {
    await env.DB.prepare(sql).run();
  }
  for (const [table, cols] of Object.entries(COLUMNS)) {
    await ensureColumns(env, table, cols);
  }
  // Only latch after the core table is confirmed, so a partial provision isn't
  // permanently skipped by the guard on later requests.
  const check = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sites'").first();
  if (check) ready = true;
}
