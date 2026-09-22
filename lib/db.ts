import type { ApiKey, Env, KeyStatus, KeyWithStatus, ModelRatio, Site, SiteWithKeys, TestResult } from "./types";

function parseStatus(row: KeyStatus | null): KeyWithStatus["status"] {
  if (!row || row.tested_at == null) return null;
  let modelRatios: ModelRatio[] = [];
  let models: string[] = [];
  try {
    modelRatios = row.model_ratios ? JSON.parse(row.model_ratios) : [];
  } catch {
    modelRatios = [];
  }
  try {
    models = row.models ? JSON.parse(row.models) : [];
  } catch {
    models = [];
  }
  return {
    alive: row.alive,
    latency_ms: row.latency_ms,
    http_status: row.http_status,
    error: row.error,
    group_ratio: row.group_ratio,
    model_ratios: modelRatios,
    models,
    balance_usd: row.balance_usd,
    total_usage_usd: row.total_usage_usd,
    pricing_source: row.pricing_source,
    tested_at: row.tested_at,
  };
}

export async function loadSitesWithKeys(env: Env): Promise<SiteWithKeys[]> {
  const sites = await env.DB.prepare(
    "SELECT * FROM sites ORDER BY sort ASC, id ASC",
  ).all<Site>();

  const keys = await env.DB.prepare(
    "SELECT * FROM api_keys ORDER BY sort ASC, id ASC",
  ).all<ApiKey>();

  const statuses = await env.DB.prepare("SELECT * FROM key_status").all<KeyStatus>();
  const statusById = new Map<number, KeyStatus>();
  for (const s of statuses.results ?? []) statusById.set(s.key_id, s);

  const keysBySite = new Map<number, KeyWithStatus[]>();
  for (const k of keys.results ?? []) {
    const withStatus: KeyWithStatus = { ...k, status: parseStatus(statusById.get(k.id) ?? null) };
    const arr = keysBySite.get(k.site_id) ?? [];
    arr.push(withStatus);
    keysBySite.set(k.site_id, arr);
  }

  return (sites.results ?? []).map((site) => ({
    ...site,
    keys: keysBySite.get(site.id) ?? [],
  }));
}

export async function saveTestResult(env: Env, keyId: number, r: TestResult): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO key_status
      (key_id, alive, latency_ms, http_status, error, group_ratio, model_ratios, models,
       balance_usd, total_usage_usd, balance_raw, pricing_source, tested_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
     ON CONFLICT(key_id) DO UPDATE SET
       alive=?2, latency_ms=?3, http_status=?4, error=?5, group_ratio=?6,
       model_ratios=?7, models=?8, balance_usd=?9, total_usage_usd=?10,
       balance_raw=?11, pricing_source=?12, tested_at=?13`,
  )
    .bind(
      keyId,
      r.alive ? 1 : 0,
      r.latency_ms,
      r.http_status,
      r.error,
      r.group_ratio,
      JSON.stringify(r.model_ratios),
      JSON.stringify(r.models),
      r.balance_usd,
      r.total_usage_usd,
      JSON.stringify(r.balance_raw ?? null),
      r.pricing_source,
      now,
    )
    .run();
}

// Update only the balance fields (preserves last-known ratios/models).
export async function saveBalance(
  env: Env,
  keyId: number,
  balanceUsd: number | null,
  totalUsageUsd: number | null,
  raw: unknown,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const existing = await env.DB.prepare("SELECT key_id FROM key_status WHERE key_id = ?1")
    .bind(keyId)
    .first();
  if (existing) {
    await env.DB.prepare(
      `UPDATE key_status
         SET balance_usd=?2, total_usage_usd=?3, balance_raw=?4, tested_at=?5
       WHERE key_id=?1`,
    )
      .bind(keyId, balanceUsd, totalUsageUsd, JSON.stringify(raw ?? null), now)
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO key_status (key_id, balance_usd, total_usage_usd, balance_raw, tested_at)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
      .bind(keyId, balanceUsd, totalUsageUsd, JSON.stringify(raw ?? null), now)
      .run();
  }
}
