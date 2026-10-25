import { fetchWithUserToken, META_UA } from "./models";
import { httpRequest, readableMessage, type HttpResult } from "./net";
import type { BalanceResult, Site } from "./types";

// Account balance (site-level: one site = one upstream account).

const BALANCE_TIMEOUT_MS = 10000;
const BALANCE_DEADLINE_MS = 15000;
const DEFAULT_QUOTA_PER_UNIT = 500000;

const get = (url: string, key: string) =>
  httpRequest(url, { method: "GET", headers: { Authorization: `Bearer ${key}`, Accept: "application/json", "User-Agent": META_UA } }, { timeoutMs: BALANCE_TIMEOUT_MS });

const authed = (r: HttpResult) => !r.networkError && r.status !== 401 && r.status !== 403;
const round = (n: number) => Number(n.toFixed(4));

function failure(source: string, r: HttpResult | null, error: string): BalanceResult {
  return { balance_usd: null, total_usage_usd: null, unlimited: false, source, raw: r ? { status: r.status } : null, reachable: r ? authed(r) : false, error };
}

// sub2api GET /v1/usage — USD floats, remaining === -1 means unlimited.
async function fetchSub2ApiUsage(base: string, key: string): Promise<BalanceResult> {
  const r = await get(`${base}/v1/usage`, key);
  const b = r.body;
  if (!r.ok || !b || typeof b !== "object") return failure("sub2api-usage", r, `余额接口失败：${readableMessage(r)}`);
  let remaining: number | null = null;
  if (b.mode === "quota_limited" && typeof b.quota?.remaining === "number") remaining = b.quota.remaining;
  else if (typeof b.balance === "number") remaining = b.balance;
  else if (typeof b.remaining === "number") remaining = b.remaining;
  const unlimited = remaining === -1;
  const used = typeof b.usage?.total?.cost === "number" ? b.usage.total.cost : null;
  // Models this key really served, most requests first — the probe tries these
  // before guessing, since a relay often lists models whose channel is broken.
  const used_models = (Array.isArray(b.model_stats) ? b.model_stats : [])
    .filter((m: any) => typeof m?.model === "string" && m.model && Number(m.requests) > 0)
    .sort((x: any, y: any) => Number(y.requests) - Number(x.requests))
    .map((m: any) => String(m.model))
    .slice(0, 5);
  return {
    balance_usd: unlimited || remaining == null ? null : round(remaining),
    total_usage_usd: used != null ? round(used) : null,
    unlimited,
    source: "sub2api-usage",
    raw: { mode: b.mode ?? null, planName: b.planName ?? null, isValid: b.isValid ?? null, remaining: b.remaining ?? null },
    reachable: true,
    error: null,
    used_models,
  };
}

// OpenAI-style billing (New-API / One-API serve it to an sk- key), then the
// OpenRouter-style credits and credit_grants fallbacks.
async function fetchOpenAiBalance(base: string, key: string): Promise<BalanceResult> {
  let reachable = false;
  const sub = await get(`${base}/v1/dashboard/billing/subscription`, key);
  if (authed(sub)) reachable = true;
  if (sub.ok && typeof sub.body?.hard_limit_usd === "number") {
    const hard = sub.body.hard_limit_usd as number;
    const now = new Date();
    const start = sub.body.has_payment_method ? new Date(now.getFullYear(), now.getMonth(), 1) : new Date(now.getTime() - 100 * 86400000);
    const end = new Date(now.getTime() + 86400000);
    const ymd = (d: Date) => d.toISOString().slice(0, 10);
    const usage = await get(`${base}/v1/dashboard/billing/usage?start_date=${ymd(start)}&end_date=${ymd(end)}`, key);
    const usedUsd = (typeof usage.body?.total_usage === "number" ? usage.body.total_usage : 0) / 100;
    // New-API reports hard_limit_usd = 1e8 for unlimited-quota tokens.
    const unlimited = hard >= 100000000;
    return {
      balance_usd: unlimited ? null : round(hard - usedUsd),
      total_usage_usd: round(usedUsd),
      unlimited,
      source: "subscription",
      raw: { hard_limit_usd: hard },
      reachable: true,
      error: null,
    };
  }

  const cr = await get(`${base}/api/v1/credits`, key);
  if (authed(cr)) reachable = true;
  const cd = cr.ok && cr.body ? (cr.body.data ?? cr.body) : null;
  if (cd && typeof cd.total_credits === "number") {
    const used = typeof cd.total_usage === "number" ? cd.total_usage : 0;
    return { balance_usd: round(cd.total_credits - used), total_usage_usd: round(used), unlimited: false, source: "credits", raw: null, reachable: true, error: null };
  }

  const cg = await get(`${base}/dashboard/billing/credit_grants`, key);
  if (authed(cg)) reachable = true;
  if (cg.ok && typeof cg.body?.total_available === "number") {
    const used = typeof cg.body.total_used === "number" ? round(cg.body.total_used) : null;
    return { balance_usd: round(cg.body.total_available), total_usage_usd: used, unlimited: false, source: "credit_grants", raw: null, reachable: true, error: null };
  }

  const err = reachable ? "该站未提供可读取的余额接口" : `余额接口失败：${readableMessage(sub)}`;
  return { balance_usd: null, total_usage_usd: null, unlimited: false, source: "none", raw: { status: sub.status }, reachable, error: err };
}

// New-API panel balance via the site access token (authoritative when set):
// GET /api/user/self → quota, GET /api/status → quota_per_unit.
async function fetchNewApiUserBalance(base: string, token: string, userId: string): Promise<BalanceResult> {
  const self = await fetchWithUserToken(`${base}/api/user/self`, token, userId);
  const data = self.ok && self.body && typeof self.body === "object" ? self.body.data : null;
  if (!data || typeof data.quota !== "number") {
    return failure("newapi-user-self", self, `访问令牌读取余额失败：${readableMessage(self)}`);
  }
  let perUnit = DEFAULT_QUOTA_PER_UNIT;
  const st = await httpRequest(`${base}/api/status`, { method: "GET", headers: { Accept: "application/json", "User-Agent": META_UA } }, { timeoutMs: BALANCE_TIMEOUT_MS });
  const sd = st.ok && st.body && typeof st.body === "object" ? st.body.data : null;
  if (typeof sd?.quota_per_unit === "number" && sd.quota_per_unit > 0) perUnit = sd.quota_per_unit;
  return {
    balance_usd: round(data.quota / perUnit),
    total_usage_usd: typeof data.used_quota === "number" ? round(data.used_quota / perUnit) : null,
    unlimited: false,
    source: "newapi-user-self",
    raw: { quota_per_unit: perUnit },
    reachable: true,
    error: null,
  };
}

async function fetchBalanceInner(base: string, key: string, site: Pick<Site, "kind" | "access_token" | "newapi_user_id">): Promise<BalanceResult> {
  if (site.kind === "sub2api") return fetchSub2ApiUsage(base, key);
  if (site.kind === "newapi" && site.access_token) {
    const user = await fetchNewApiUserBalance(base, site.access_token, site.newapi_user_id);
    if (user.balance_usd != null) return user;
    const viaKey = await fetchOpenAiBalance(base, key);
    if (viaKey.balance_usd != null) return viaKey;
    return { ...viaKey, error: user.error ?? viaKey.error };
  }
  return fetchOpenAiBalance(base, key);
}

// Bounded by an overall deadline so a slow billing chain never stalls a test.
export async function fetchBalance(base: string, key: string, site: Pick<Site, "kind" | "access_token" | "newapi_user_id">): Promise<BalanceResult> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<BalanceResult>((resolve) => {
    timer = setTimeout(
      () => resolve({ balance_usd: null, total_usage_usd: null, unlimited: false, source: "none", raw: null, reachable: false, error: "余额接口超时" }),
      BALANCE_DEADLINE_MS,
    );
  });
  try {
    return await Promise.race([fetchBalanceInner(base, key, site), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
