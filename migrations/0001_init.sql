-- 中转站监控平台 - 数据库结构
-- Sites (中转站): one site can hold many keys/groups.
CREATE TABLE IF NOT EXISTS sites (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  base_url     TEXT    NOT NULL,
  kind         TEXT    NOT NULL DEFAULT 'newapi', -- 'newapi' | 'sub2api' | 'openai'
  note         TEXT    NOT NULL DEFAULT '',
  access_token TEXT    NOT NULL DEFAULT '',       -- New-API 用户「访问令牌」，用于读取锁在登录后的 /api/pricing
  sort         INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

-- API keys / groups belonging to a site.
CREATE TABLE IF NOT EXISTS api_keys (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id       INTEGER NOT NULL,
  label         TEXT    NOT NULL DEFAULT '',   -- 显示名称，例如 "GPT分组-1"
  group_name    TEXT    NOT NULL DEFAULT '',   -- 上游分组标识，用于匹配 group_ratio
  api_key       TEXT    NOT NULL,              -- sk-...
  sort          INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_api_keys_site ON api_keys(site_id);

-- Latest test result per key. Kept in a separate table so the last known
-- multiplier/balance always renders even before a fresh re-test.
CREATE TABLE IF NOT EXISTS key_status (
  key_id           INTEGER PRIMARY KEY,
  alive            INTEGER,               -- 1 alive, 0 dead, NULL never tested
  latency_ms       INTEGER,
  http_status      INTEGER,
  error            TEXT,
  group_ratio      REAL,                  -- matched group multiplier (分组倍率)
  model_ratios     TEXT,                  -- JSON: [{model, model_ratio, completion_ratio, quota_type, model_price}]
  models           TEXT,                  -- JSON: string[] of accessible model ids
  balance_usd      REAL,                  -- remaining balance in USD (nullable)
  total_usage_usd  REAL,                  -- used amount in USD (nullable)
  balance_raw      TEXT,                  -- JSON: raw balance source detail
  pricing_source   TEXT,                  -- 'pricing' | 'sub2api-billing' | 'none'
  tested_at        INTEGER,
  FOREIGN KEY (key_id) REFERENCES api_keys(id) ON DELETE CASCADE
);
