import type { ModelRatio, SiteKind, TestResult } from "./types";

// Talks to upstream relay stations (New-API / One-API / sub2api / OpenAI-
// compatible). Runs server-side inside Pages Functions, so it is not subject
// to browser CORS and the API keys never reach the client.

const DEFAULT_TIMEOUT_MS = 15000;

function normalizeBase(base: string): string {
  return base.trim().replace(/\/+$/, "");
}

interface HttpResult {
  status: number;
  ok: boolean;
  body: any;
  latency: number;
  networkError: boolean;
}

async function fetchJson(url: string, init: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<HttpResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const latency = Date.now() - start;
    const text = await res.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: res.status, ok: res.ok, body, latency, networkError: false };
  } catch (e: any) {
    return { status: 0, ok: false, body: e?.name === "AbortError" ? "请求超时" : e?.message || "网络错误", latency: 0, networkError: true };
  } finally {
    clearTimeout(timer);
  }
}

function authHeaders(key: string): HeadersInit {
  return {
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
    "User-Agent": "relay-monitor/1.0",
  };
}

// Call a New-API user-scoped panel endpoint (/api/pricing, /api/user/self) with
// the operator's access token. New-API's user-auth middleware reads the token
// from a raw `Authorization` header; some forks expect `Bearer`, so we retry
// with that prefix when the raw form is rejected.
async function fetchWithUserToken(url: string, accessToken: string): Promise<HttpResult> {
  const base = { Accept: "application/json", "User-Agent": "relay-monitor/1.0" };
  let res = await fetchJson(url, { method: "GET", headers: { ...base, Authorization: accessToken } });
  if (res.status === 401 || res.status === 403) {
    res = await fetchJson(url, { method: "GET", headers: { ...base, Authorization: `Bearer ${accessToken}` } });
  }
  return res;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function extractMsg(body: any, status: number): string {
  const msg = (body && (body.error?.message || body.message || (typeof body === "string" ? body : null))) || `HTTP ${status}`;
  return String(msg).slice(0, 300);
}

// ---- Liveness + accessible models via GET /v1/models -----------------------
async function fetchModels(
  base: string,
  key: string,
): Promise<{ status: number; latency: number; models: string[]; error: string | null; reachable: boolean }> {
  const { status, ok, body, latency, networkError } = await fetchJson(`${base}/v1/models`, {
    method: "GET",
    headers: authHeaders(key),
  });
  if (networkError) {
    return { status: 0, latency: 0, models: [], error: extractMsg(body, 0), reachable: false };
  }
  if (!ok) {
    // A 401/403 means the key is bad; other codes (404/405/…) still prove the
    // station is reachable, we just cannot enumerate models from this route.
    return { status, latency, models: [], error: extractMsg(body, status), reachable: status !== 401 && status !== 403 };
  }
  let models: string[] = [];
  if (body && Array.isArray(body.data)) {
    models = body.data.map((m: any) => m.id ?? m.model ?? m.slug).filter(Boolean);
  } else if (body && Array.isArray(body.models)) {
    models = body.models.map((m: any) => m.id ?? m.slug ?? m.model).filter(Boolean);
  }
  return { status, latency, models, error: null, reachable: true };
}

// ---- New-API pricing: GET /api/pricing -------------------------------------
// Returns per-model ratios (data[]) plus a top-level group_ratio map. We match
// the key's declared group_name to pick its group multiplier.
//
// Many New-API stations gate /api/pricing behind login: it runs through the
// user-auth middleware, not token-auth, so the relay `sk-` key gets 401 there.
// When the operator has supplied a New-API "access token" for the site, we send
// it instead. New-API reads that token from a raw `Authorization` header (no
// `Bearer` prefix); some forks accept `Bearer`, so we try raw first and fall
// back. Without an access token we still try the `sk-` key — it works on
// stations that leave pricing public.
async function fetchNewApiPricing(
  base: string,
  key: string,
  groupName: string,
  accessToken: string,
): Promise<{ groupRatio: number | null; ratios: ModelRatio[]; found: boolean }> {
  const url = `${base}/api/pricing`;
  const { ok, body } = accessToken
    ? await fetchWithUserToken(url, accessToken)
    : await fetchJson(url, { method: "GET", headers: authHeaders(key) });
  if (!ok || !body || typeof body !== "object") return { groupRatio: null, ratios: [], found: false };

  const data = Array.isArray(body.data) ? body.data : [];
  const ratios: ModelRatio[] = data
    .map((p: any) => ({
      model: p.model_name ?? p.model ?? "",
      model_ratio: typeof p.model_ratio === "number" ? p.model_ratio : null,
      completion_ratio: typeof p.completion_ratio === "number" ? p.completion_ratio : null,
      quota_type: typeof p.quota_type === "number" ? p.quota_type : null,
      model_price: typeof p.model_price === "number" ? p.model_price : null,
    }))
    .filter((r: ModelRatio) => r.model);

  let groupRatio: number | null = null;
  const gr = body.group_ratio;
  if (gr && typeof gr === "object") {
    if (groupName && typeof gr[groupName] === "number") {
      groupRatio = gr[groupName];
    } else if (typeof gr.default === "number") {
      groupRatio = gr.default;
    } else {
      const vals = Object.values(gr).filter((v) => typeof v === "number") as number[];
      if (vals.length === 1) groupRatio = vals[0];
    }
  }
  const found = ratios.length > 0 || groupRatio !== null;
  return { groupRatio, ratios, found };
}

// ---- sub2api group multiplier: GET /v1/sub2api/billing ----------------------
// sub2api ships a purpose-built endpoint that returns the multiplier effective
// for the authenticated key (source: gateway_key_billing.go -> KeyBillingInfo):
//   effective_rate_multiplier = resolved_rate_multiplier * applied_peak
//   resolved_rate_multiplier  = user override, else the group's rate multiplier
// This is the ONLY authoritative "上游倍率" source reachable with an sk- key —
// the per-model /api/v1/model-plaza is behind browser-JWT auth, so an sk- key
// only sees an anonymous default view there; we deliberately do not use it.
async function fetchSub2ApiBilling(
  base: string,
  key: string,
): Promise<{ groupRatio: number | null; reachable: boolean; status: number }> {
  const { ok, body, status, networkError } = await fetchJson(`${base}/v1/sub2api/billing`, {
    method: "GET",
    headers: authHeaders(key),
  });
  if (networkError) return { groupRatio: null, reachable: false, status: 0 };
  if (!ok || !body || typeof body !== "object") {
    // 404 = simple mode, 403 = key not in a group; both mean "reachable, no ratio".
    return { groupRatio: null, reachable: status !== 401, status };
  }
  const ratio =
    typeof body.effective_rate_multiplier === "number"
      ? body.effective_rate_multiplier
      : typeof body.resolved_rate_multiplier === "number"
        ? body.resolved_rate_multiplier
        : typeof body.group_rate_multiplier === "number"
          ? body.group_rate_multiplier
          : null;
  return { groupRatio: ratio, reachable: true, status };
}

// ---- Balance -----------------------------------------------------------------
interface BalanceResult {
  balance_usd: number | null;
  total_usage_usd: number | null;
  raw: unknown;
  reachable: boolean; // an authed balance endpoint answered (not a network/auth failure)
}

// sub2api balance: GET /v1/usage (built by sub2api "for CC Switch integration").
// Amounts are already USD floats — NO /500000 or /100 conversion. Three modes:
//   quota_limited  -> quota.remaining
//   unrestricted+wallet -> balance
//   unrestricted+subscription -> remaining (min of per-window remaining)
// A top-level `remaining` is always present as the safest generic value;
// remaining === -1 means "unlimited".
async function fetchSub2ApiUsage(base: string, key: string): Promise<BalanceResult> {
  const { ok, body, status, networkError } = await fetchJson(`${base}/v1/usage`, {
    method: "GET",
    headers: authHeaders(key),
  });
  if (networkError) return { balance_usd: null, total_usage_usd: null, raw: { source: "usage", error: body }, reachable: false };
  if (!ok || !body || typeof body !== "object") {
    return { balance_usd: null, total_usage_usd: null, raw: { source: "usage", status }, reachable: status !== 401 && status !== 403 };
  }

  let remaining: number | null = null;
  if (body.mode === "quota_limited" && body.quota && typeof body.quota.remaining === "number") {
    remaining = body.quota.remaining;
  } else if (typeof body.balance === "number") {
    remaining = body.balance;
  } else if (typeof body.remaining === "number") {
    remaining = body.remaining;
  }
  // -1 = unlimited; represent as null so the UI shows "无限/—" not "-1".
  if (remaining === -1) remaining = null;

  const usedCost =
    body.usage && body.usage.total && typeof body.usage.total.cost === "number" ? body.usage.total.cost : null;

  return {
    balance_usd: remaining != null ? Number(remaining.toFixed(4)) : null,
    total_usage_usd: usedCost != null ? Number(usedCost.toFixed(4)) : null,
    raw: { source: "sub2api-usage", usage: body },
    reachable: true,
  };
}

// New-API / One-API / OpenAI-compatible balance: OpenAI dashboard billing.
//   remaining = hard_limit_usd - total_usage/100   (total_usage is in cents)
// Both /v1/dashboard/billing/subscription and /usage sit behind TokenAuth on
// new-api/one-api, so an sk- key works. Fallbacks: OpenRouter-style
// /api/v1/credits (total_credits - total_usage) then /dashboard/billing/credit_grants.
async function fetchOpenAiBalance(base: string, key: string): Promise<BalanceResult> {
  let reachable = false;

  const sub = await fetchJson(`${base}/v1/dashboard/billing/subscription`, { method: "GET", headers: authHeaders(key) });
  if (!sub.networkError && sub.status !== 401 && sub.status !== 403) reachable = true;
  if (sub.ok && sub.body && typeof sub.body.hard_limit_usd === "number") {
    const hardLimit = sub.body.hard_limit_usd as number;
    const now = new Date();
    const start = sub.body.has_payment_method
      ? new Date(now.getFullYear(), now.getMonth(), 1)
      : new Date(now.getTime() - 100 * 24 * 3600 * 1000);
    const end = new Date(now.getTime() + 24 * 3600 * 1000);
    const usage = await fetchJson(
      `${base}/v1/dashboard/billing/usage?start_date=${ymd(start)}&end_date=${ymd(end)}`,
      { method: "GET", headers: authHeaders(key) },
    );
    const totalUsageCents = usage.ok && usage.body && typeof usage.body.total_usage === "number" ? usage.body.total_usage : 0;
    const usedUsd = totalUsageCents / 100;
    // New-API hard-codes hard_limit_usd = 100000000 for UNLIMITED-quota tokens
    // (see controller/billing.go). Don't surface "1亿 − 用量" as a balance; report
    // it as unlimited (null) and keep the meaningful used amount instead.
    const unlimited = hardLimit >= 100000000;
    return {
      balance_usd: unlimited ? null : Number((hardLimit - usedUsd).toFixed(4)),
      total_usage_usd: Number(usedUsd.toFixed(4)),
      raw: { source: "subscription", unlimited, subscription: sub.body, usage: usage.body },
      reachable: true,
    };
  }

  const cr = await fetchJson(`${base}/api/v1/credits`, { method: "GET", headers: authHeaders(key) });
  if (!cr.networkError && cr.status !== 401 && cr.status !== 403) reachable = true;
  const cd = cr.ok && cr.body ? (cr.body.data ?? cr.body) : null;
  if (cd && typeof cd === "object" && typeof cd.total_credits === "number") {
    const totalCredits = cd.total_credits as number;
    const totalUsage = typeof cd.total_usage === "number" ? cd.total_usage : 0;
    return {
      balance_usd: Number((totalCredits - totalUsage).toFixed(4)),
      total_usage_usd: Number(totalUsage.toFixed(4)),
      raw: { source: "credits", credits: cd },
      reachable: true,
    };
  }

  const cg = await fetchJson(`${base}/dashboard/billing/credit_grants`, { method: "GET", headers: authHeaders(key) });
  if (!cg.networkError && cg.status !== 401 && cg.status !== 403) reachable = true;
  if (cg.ok && cg.body && typeof cg.body.total_available === "number") {
    return {
      balance_usd: Number(cg.body.total_available.toFixed(4)),
      total_usage_usd: typeof cg.body.total_used === "number" ? Number(cg.body.total_used.toFixed(4)) : null,
      raw: { source: "credit_grants", credit_grants: cg.body },
      reachable: true,
    };
  }

  return { balance_usd: null, total_usage_usd: null, raw: { source: "none" }, reachable };
}

// New-API user balance via the panel API (needs the site access token). The
// sk- billing routes often report the "unlimited" sentinel or 401 on New-API,
// so when a token is present this is the authoritative balance:
//   GET /api/user/self  -> { data: { quota, used_quota } }  (New-API quota unit)
//   GET /api/status     -> { data: { quota_per_unit } }     (quota per 1 USD)
// balance_usd = quota / quota_per_unit. quota_per_unit defaults to 500000.
const DEFAULT_QUOTA_PER_UNIT = 500000;

async function fetchNewApiUserBalance(base: string, accessToken: string): Promise<BalanceResult> {
  const self = await fetchWithUserToken(`${base}/api/user/self`, accessToken);
  if (self.networkError) {
    return { balance_usd: null, total_usage_usd: null, raw: { source: "user-self", error: self.body }, reachable: false };
  }
  const data = self.ok && self.body && typeof self.body === "object" ? self.body.data : null;
  if (!data || typeof data !== "object" || typeof data.quota !== "number") {
    // 401/403 => token wrong; other codes still let the caller fall back.
    return {
      balance_usd: null,
      total_usage_usd: null,
      raw: { source: "user-self", status: self.status },
      reachable: self.status !== 401 && self.status !== 403,
    };
  }

  // quota_per_unit is exposed on the public /api/status; fall back to the default.
  let quotaPerUnit = DEFAULT_QUOTA_PER_UNIT;
  const status = await fetchJson(`${base}/api/status`, {
    method: "GET",
    headers: { Accept: "application/json", "User-Agent": "relay-monitor/1.0" },
  });
  const sd = status.ok && status.body && typeof status.body === "object" ? status.body.data : null;
  if (sd && typeof sd.quota_per_unit === "number" && sd.quota_per_unit > 0) {
    quotaPerUnit = sd.quota_per_unit;
  }

  const remaining = data.quota / quotaPerUnit;
  const used = typeof data.used_quota === "number" ? data.used_quota / quotaPerUnit : null;
  return {
    balance_usd: Number(remaining.toFixed(4)),
    total_usage_usd: used != null ? Number(used.toFixed(4)) : null,
    raw: { source: "newapi-user-self", quota_per_unit: quotaPerUnit, quota: data.quota, used_quota: data.used_quota },
    reachable: true,
  };
}

async function fetchBalance(base: string, key: string, kind: SiteKind, accessToken: string): Promise<BalanceResult> {
  if (kind === "sub2api") return fetchSub2ApiUsage(base, key);
  // New-API with an access token: the user-panel balance is authoritative and
  // works even where the sk- billing routes are locked or report "unlimited".
  if (kind === "newapi" && accessToken) {
    const userBal = await fetchNewApiUserBalance(base, accessToken);
    if (userBal.reachable && userBal.balance_usd != null) return userBal;
  }
  return fetchOpenAiBalance(base, key);
}

// ---- Orchestrator ------------------------------------------------------------
export async function testKey(
  baseUrl: string,
  apiKey: string,
  kind: SiteKind,
  groupName: string,
  accessToken = "",
): Promise<TestResult> {
  const base = normalizeBase(baseUrl);

  const [modelsRes, pricingRes, balanceRes] = await Promise.all([
    fetchModels(base, apiKey),
    fetchPricing(base, apiKey, kind, groupName, accessToken),
    fetchBalance(base, apiKey, kind, accessToken),
  ]);

  // A 401/403 on GET /v1/models normally means THIS sk- key was rejected →
  // authoritatively dead, and NOT overridden by a reachable pricing/balance
  // endpoint (on New-API those authenticate with the site ACCESS TOKEN, so they
  // answer even for a rejected key — the reported "无效 key 却显示可用" bug).
  //
  // EXCEPTION: when the upstream account is out of money, New-API rejects even a
  // VALID key here with "insufficient account balance". That must surface as
  // 无额度 (alive + balance≤0), not 不可用. So if the balance endpoint confirms the
  // account is drained, keep the key alive and let keyState() render 无额度.
  //
  // Only when the key was NOT rejected do we fall back to "可达即可用": the station
  // counts as alive if any authed endpoint answered without an auth failure — that
  // keeps a valid key alive when /v1/models happens to 404/405 on the station.
  const modelsOk = modelsRes.status >= 200 && modelsRes.status < 300;
  const modelsRejected = modelsRes.status === 401 || modelsRes.status === 403;
  const balanceSpent = balanceRes.balance_usd != null && balanceRes.balance_usd <= 0;
  let alive: boolean;
  if (modelsOk) {
    alive = true;
  } else if (modelsRejected) {
    alive = balanceSpent; // drained account → 无额度; otherwise a genuinely bad key → 不可用
  } else {
    alive = modelsRes.reachable || pricingRes.reachable || balanceRes.reachable;
  }

  return {
    alive,
    latency_ms: modelsRes.latency || null,
    http_status: modelsRes.status || null,
    error: alive ? null : modelsRes.error,
    group_ratio: pricingRes.groupRatio,
    model_ratios: pricingRes.ratios,
    models: modelsRes.models,
    balance_usd: balanceRes.balance_usd,
    total_usage_usd: balanceRes.total_usage_usd,
    balance_raw: balanceRes.raw,
    pricing_source: pricingRes.source,
  };
}

interface PricingResult {
  groupRatio: number | null;
  ratios: ModelRatio[];
  reachable: boolean;
  source: TestResult["pricing_source"];
}

async function fetchPricing(base: string, key: string, kind: SiteKind, groupName: string, accessToken: string): Promise<PricingResult> {
  if (kind === "openai") {
    return { groupRatio: null, ratios: [], reachable: false, source: "none" };
  }
  if (kind === "sub2api") {
    const billing = await fetchSub2ApiBilling(base, key);
    // Per-model ratios are not reachable with an sk- key on sub2api; report the
    // authoritative group multiplier and leave model_ratios honestly empty.
    return {
      groupRatio: billing.groupRatio,
      ratios: [],
      reachable: billing.reachable,
      source: billing.groupRatio != null ? "sub2api-billing" : "none",
    };
  }
  const p = await fetchNewApiPricing(base, key, groupName, accessToken);
  return { groupRatio: p.groupRatio, ratios: p.ratios, reachable: p.found, source: p.found ? "pricing" : "none" };
}

// Balance-only refresh (used for auto-refresh on login / manual refresh).
export async function refreshBalance(baseUrl: string, apiKey: string, kind: SiteKind, accessToken = "") {
  const base = normalizeBase(baseUrl);
  return fetchBalance(base, apiKey, kind, accessToken);
}
