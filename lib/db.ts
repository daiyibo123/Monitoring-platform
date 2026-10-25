import type {
  ApiKey,
  BalanceResult,
  Env,
  KeyState,
  KeyStatusRow,
  ModelRatio,
  ProbeSummary,
  PublicKey,
  PublicKeyStatus,
  PublicSite,
  PublicSiteBalance,
  Site,
  SiteStatusRow,
  TestResult,
} from "./types";

const nowSec = () => Math.floor(Date.now() / 1000);
const STATES = new Set<KeyState>(["ok", "no_quota", "dead", "error"]);

function parseJson<T>(s: string | null, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

// A row counts as a test result only once it carries a verdict. Rows written by
// the old balance-only refresh (no alive/state) read as "never tested".
export function publicStatus(row: KeyStatusRow | null | undefined): PublicKeyStatus | null {
  if (!row || row.tested_at == null || (row.alive == null && row.state == null)) return null;
  return {
    state: STATES.has(row.state as KeyState) ? (row.state as KeyState) : null,
    alive: row.alive,
    latency_ms: row.latency_ms,
    http_status: row.http_status,
    error: row.error,
    group_ratio: row.group_ratio,
    model_ratios: parseJson<ModelRatio[]>(row.model_ratios, []),
    models: parseJson<string[]>(row.models, []),
    balance_usd: row.balance_usd,
    total_usage_usd: row.total_usage_usd,
    pricing_source: row.pricing_source,
    probe: parseJson<ProbeSummary | null>(row.probe, null),
    tested_at: row.tested_at,
  };
}

export function maskKey(key: string): string {
  const k = key.trim();
  if (k.length <= 8) return "••••••";
  if (k.length <= 16) return `${k.slice(0, 3)}••••${k.slice(-2)}`;
  return `${k.slice(0, 6)}••••${k.slice(-4)}`;
}

export function publicBalance(row: SiteStatusRow | null | undefined): PublicSiteBalance | null {
  if (!row) return null;
  return {
    usd: row.balance_usd,
    usage_usd: row.total_usage_usd,
    unlimited: row.unlimited === 1,
    source: row.source,
    error: row.error,
    checked_at: row.checked_at,
    ok_at: row.ok_at,
  };
}

export async function loadPublicSites(env: Env): Promise<PublicSite[]> {
  const [sites, keys, statuses, siteStatuses] = await Promise.all([
    env.DB.prepare("SELECT * FROM sites ORDER BY sort ASC, id ASC").all<Site>(),
    env.DB.prepare("SELECT * FROM api_keys ORDER BY sort ASC, id ASC").all<ApiKey>(),
    env.DB.prepare("SELECT * FROM key_status").all<KeyStatusRow>(),
    env.DB.prepare("SELECT * FROM site_status").all<SiteStatusRow>(),
  ]);
  const statusById = new Map((statuses.results ?? []).map((s) => [s.key_id, s] as const));
  const siteStatusById = new Map((siteStatuses.results ?? []).map((s) => [s.site_id, s] as const));

  const keysBySite = new Map<number, PublicKey[]>();
  for (const k of keys.results ?? []) {
    const pk: PublicKey = {
      id: k.id,
      site_id: k.site_id,
      label: k.label,
      group_name: k.group_name,
      key_masked: maskKey(k.api_key),
      probe_model: k.probe_model ?? "",
      sort: k.sort,
      created_at: k.created_at,
      updated_at: k.updated_at,
      status: publicStatus(statusById.get(k.id)),
    };
    const arr = keysBySite.get(k.site_id);
    if (arr) arr.push(pk);
    else keysBySite.set(k.site_id, [pk]);
  }

  return (sites.results ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    base_url: s.base_url,
    kind: s.kind,
    note: s.note,
    has_access_token: Boolean(s.access_token),
    newapi_user_id: s.newapi_user_id ?? "",
    sort: s.sort,
    created_at: s.created_at,
    updated_at: s.updated_at,
    balance: publicBalance(siteStatusById.get(s.id)),
    keys: keysBySite.get(s.id) ?? [],
  }));
}

// Persist one test. Balance columns are only overwritten by a fresh, readable
// balance; a cached or failed reading keeps the last known values.
export async function saveTestResult(env: Env, keyId: number, r: TestResult): Promise<PublicKeyStatus | null> {
  const writeBalance = r.balance_fresh && r.balance.reachable ? 1 : 0;
  await env.DB.prepare(
    `INSERT INTO key_status
      (key_id, state, alive, latency_ms, http_status, error, group_ratio, model_ratios, models,
       balance_usd, total_usage_usd, balance_raw, pricing_source, probe, tested_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
     ON CONFLICT(key_id) DO UPDATE SET
       state=?2, alive=?3, latency_ms=?4, http_status=?5, error=?6, group_ratio=?7,
       model_ratios=?8, models=?9,
       balance_usd=CASE WHEN ?16=1 THEN ?10 ELSE key_status.balance_usd END,
       total_usage_usd=CASE WHEN ?16=1 THEN ?11 ELSE key_status.total_usage_usd END,
       balance_raw=CASE WHEN ?16=1 THEN ?12 ELSE key_status.balance_raw END,
       pricing_source=?13, probe=?14, tested_at=?15`,
  )
    .bind(
      keyId,
      r.state,
      r.alive ? 1 : 0,
      r.latency_ms,
      r.http_status,
      r.error,
      r.group_ratio,
      JSON.stringify(r.model_ratios),
      JSON.stringify(r.models),
      writeBalance ? r.balance.balance_usd : null,
      writeBalance ? r.balance.total_usage_usd : null,
      writeBalance ? JSON.stringify({ source: r.balance.source, raw: r.balance.raw }) : null,
      r.pricing_source,
      JSON.stringify(r.probe),
      nowSec(),
      writeBalance,
    )
    .run();
  const row = await env.DB.prepare("SELECT * FROM key_status WHERE key_id=?1").bind(keyId).first<KeyStatusRow>();
  return publicStatus(row);
}

// A good reading replaces the site balance; a failed refresh only records the
// error, so the last known balance stays on screen.
export async function saveSiteBalance(env: Env, siteId: number, b: BalanceResult): Promise<void> {
  const now = nowSec();
  const good = b.reachable && (b.balance_usd != null || b.unlimited);
  if (good) {
    await env.DB.prepare(
      `INSERT INTO site_status (site_id, balance_usd, total_usage_usd, unlimited, source, error, checked_at, ok_at)
       VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?6)
       ON CONFLICT(site_id) DO UPDATE SET
         balance_usd=?2, total_usage_usd=?3, unlimited=?4, source=?5, error=NULL, checked_at=?6, ok_at=?6`,
    )
      .bind(siteId, b.balance_usd, b.total_usage_usd, b.unlimited ? 1 : 0, b.source, now)
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO site_status (site_id, unlimited, error, checked_at) VALUES (?1, 0, ?2, ?3)
       ON CONFLICT(site_id) DO UPDATE SET error=?2, checked_at=?3`,
    )
      .bind(siteId, b.error || "余额读取失败", now)
      .run();
  }
}

export async function loadSiteBalance(env: Env, siteId: number): Promise<PublicSiteBalance | null> {
  const row = await env.DB.prepare("SELECT * FROM site_status WHERE site_id=?1").bind(siteId).first<SiteStatusRow>();
  return publicBalance(row);
}

// The site's last good balance if it was read within maxAgeSec, else null.
export async function cachedSiteBalance(env: Env, siteId: number, maxAgeSec: number): Promise<BalanceResult | null> {
  const row = await env.DB.prepare("SELECT * FROM site_status WHERE site_id=?1").bind(siteId).first<SiteStatusRow>();
  if (!row || row.ok_at == null || nowSec() - row.ok_at > maxAgeSec) return null;
  return {
    balance_usd: row.balance_usd,
    total_usage_usd: row.total_usage_usd,
    unlimited: row.unlimited === 1,
    source: row.source || "cache",
    raw: null,
    reachable: true,
    error: null,
  };
}
