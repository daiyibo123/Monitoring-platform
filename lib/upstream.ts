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
  if (body && typeof body === "object") {
    const err = typeof body.error === "string" ? body.error : body.error?.message;
    const msg = err || body.message;
    if (msg) return String(msg).slice(0, 300);
  }
  if (typeof body === "string") {
    const s = body.trim();
    // Non-JSON responses are gateway/error/challenge PAGES (Cloudflare 5xx or
    // "checking your browser", nginx/origin errors, WAF blocks). Never surface
    // the raw markup — summarise it so the key card shows a readable reason
    // instead of a screenful of <!DOCTYPE html>…
    if (s.startsWith("<") || /^\s*<!doctype/i.test(s)) {
      return `上游返回了非 JSON 页面（HTTP ${status || "?"}，通常是网关错误/超时或防护拦截页）`;
    }
    if (s) return s.slice(0, 300);
  }
  return `HTTP ${status}`;
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
export interface BalanceResult {
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

// ---- Real-request liveness probe: POST /v1/chat/completions ----------------
// GET /v1/models only proves the station will LIST models — most relays answer
// 200 there even when the key/group has no usable channel, the account is out
// of money, or the key is restricted. So "能列模型" ≠ "能发请求". The verdict is
// therefore decided by a REAL chat request and nothing else: 可用 means a genuine
// completion actually came back.
//
// To make that verdict both TRUTHFUL and COMPLETE — the operator's hard rule is a
// key they can't actually use must NEVER show 可用, AND a good key must not be
// failed on our own noise — the probe escalates at ZERO extra token cost:
//   • try FAMILY-DIVERSE, cheapest-first models (see pickProbeModels) — so a key
//     scoped to one family (claude/gemini/deepseek/…) still gets a model it can use;
//   • try BOTH endpoint shapes for a "claude" model — the Anthropic-native
//     POST /v1/messages (x-api-key + anthropic-version) FIRST, then the OpenAI
//     /v1/chat/completions fallback — because many Claude stations ONLY answer the
//     Anthropic path and 403 the OpenAI one (a good key would else show 不可用, the
//     exact "这个是可用的但显示不可用" + "HTTP 403 非 JSON 页面" the operator hit);
//   • send the probe with a browser-like User-Agent, so a Cloudflare/WAF bot
//     filter that 403s a non-browser UA doesn't turn a good key into a false 不可用;
//   • a transient failure (超时 / 5xx / 网关或防护页) is retried once after a short
//     delay, so a one-off blip doesn't fail a good key;
//   • a model/channel failure falls back to the next candidate model — the key may
//     work with a different model;
//   • HTTP 200 only counts as 可用 if the body carries a real completion (choices[]
//     for OpenAI, content[] for Anthropic), so a 200-wrapped "无可用渠道" error can't
//     masquerade as alive;
//   • the whole escalation is capped (PROBE_MAX_MODELS / PROBE_MAX_ATTEMPTS) to bound subrequests.
// Only a genuine SUCCESS generates tokens (~2, from a "hi" + max_tokens:1); every
// failure returns an error WITHOUT a completion, so the retries/fallbacks cost 0
// tokens and the minimum-token guarantee holds. Runs on the manual 测活 buttons
// and on the once-per-day auto sweep (lib/autotest.ts); never on balance refresh.
// Some relay stations sit behind Cloudflare/WAF that 403s a non-browser
// User-Agent on the POST completion path (while GET /v1/models may still pass).
// Send the real-request probe with a browser-like UA so a bot filter doesn't turn
// a good key into a false 不可用. (Balance/models/pricing keep their own UA — they
// already work and this change is scoped to the probe that was misfiring.)
const PROBE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const PROBE_MODEL_PREFERENCES = [
  "gpt-4o-mini",
  "gpt-4.1-mini",
  "gpt-3.5-turbo",
  "gpt-4o-mini-2024-07-18",
  "deepseek-chat",
  "gemini-1.5-flash",
  "gemini-2.0-flash",
  "claude-3-haiku-20240307",
  "qwen-turbo",
  "glm-4-flash",
  "moonshot-v1-8k",
];

// Broad, family-diverse set used ONLY when the station advertises no models at all
// (some New-API forks return an EMPTY /v1/models to an sk- token — the old code
// then only ever probed "gpt-4o-mini", so ANY station lacking that one model
// failed EVERY key). One cheap model per major family so a group scoped to any
// single family (claude-only / gemini-only / deepseek-only …) still gets a probe.
const FALLBACK_PROBE_MODELS = [
  "gpt-4o-mini",
  "gpt-3.5-turbo",
  "gpt-4o",
  "deepseek-chat",
  "gemini-1.5-flash",
  "claude-3-haiku-20240307",
  "claude-3-5-sonnet-20241022",
  "qwen-turbo",
  "glm-4-flash",
  "moonshot-v1-8k",
];

// Coarse model-family bucket from the model id, so probe candidates spread across
// families instead of trying five OpenAI models and never the one Claude model the
// key's group actually allows.
function modelFamily(model: string): string {
  const m = model.toLowerCase();
  if (m.includes("claude")) return "claude";
  if (m.includes("gemini") || m.includes("gemma")) return "gemini";
  if (m.includes("deepseek")) return "deepseek";
  if (m.includes("qwen") || m.includes("qwq")) return "qwen";
  if (m.includes("glm") || m.includes("chatglm")) return "glm";
  if (m.includes("moonshot") || m.includes("kimi")) return "moonshot";
  if (m.includes("grok")) return "grok";
  if (m.includes("llama")) return "llama";
  if (m.includes("mistral") || m.includes("mixtral")) return "mistral";
  if (m.includes("ernie") || m.includes("doubao") || m.includes("hunyuan") || m.includes("spark") || m.includes("yi-") || m.includes("abab") || m.includes("step-")) return "cn-other";
  if (m.includes("gpt") || m.startsWith("o1") || m.startsWith("o3") || m.startsWith("o4") || m.includes("chatgpt") || m.includes("text-")) return "openai";
  return "other";
}

// Ordered probe candidates. We must find a model the KEY can actually use, so we
// pick FAMILY-DIVERSE, cheapest-first. The false-negative that made good keys show
// 不可用 was picking only the 3 cheapest (often all one family, none in the key's
// group) or — when /v1/models came back empty — only "gpt-4o-mini". Now each family
// is ranked cheapest-first and we round-robin one model per family, so even a small
// budget covers whatever family the key is scoped to.
function pickProbeModels(models: string[], ratios: ModelRatio[], limit: number): string[] {
  const advertised = models.length ? models : ratios.map((r) => r.model).filter(Boolean);
  const pool = Array.from(new Set(advertised.length ? advertised : FALLBACK_PROBE_MODELS));

  const ratioOf = new Map<string, number>();
  for (const r of ratios) {
    if (r.model && typeof r.model_ratio === "number" && r.model_ratio > 0 && !ratioOf.has(r.model)) {
      ratioOf.set(r.model, r.model_ratio);
    }
  }
  const prefRank = new Map(PROBE_MODEL_PREFERENCES.map((m, i) => [m, i] as const));
  // Lower = cheaper / more preferred: known dirt-cheap names first, then priced
  // models by ratio, then names that merely LOOK cheap (mini/flash/turbo/…), rest last.
  const cheapness = (m: string): number => {
    const pref = prefRank.get(m);
    if (pref != null) return -1000 + pref;
    const r = ratioOf.get(m);
    if (r != null) return r;
    if (/mini|flash|lite|nano|small|turbo|8k|tiny|air|instant|haiku|fast|micro|free/i.test(m)) return 100;
    return 1000;
  };

  const byFamily = new Map<string, string[]>();
  for (const m of pool) {
    const arr = byFamily.get(modelFamily(m));
    if (arr) arr.push(m);
    else byFamily.set(modelFamily(m), [m]);
  }
  for (const arr of byFamily.values()) arr.sort((a, b) => cheapness(a) - cheapness(b));
  // Families ordered by their cheapest member, then round-robin across them.
  const families = Array.from(byFamily.values()).sort((a, b) => cheapness(a[0]) - cheapness(b[0]));

  const ranked: string[] = [];
  for (let depth = 0; ranked.length < limit; depth++) {
    let advanced = false;
    for (const arr of families) {
      if (depth < arr.length) {
        ranked.push(arr[depth]);
        advanced = true;
        if (ranked.length >= limit) break;
      }
    }
    if (!advanced) break;
  }
  if (!ranked.length) ranked.push("gpt-4o-mini");
  return ranked.slice(0, Math.max(1, limit));
}

interface ProbeResult {
  status: number;
  ok: boolean;
  latency: number;
  error: string | null;
  drained: boolean; // failed because the account is out of money → 无额度
  invalidKey: boolean; // the station actively rejected THIS key → 不可用
  model: string;
}

// A drained account rejects a real request with 402, or a message about balance/
// quota exhaustion — surface as 无额度 (key valid, no money), NOT 不可用.
function looksDrained(status: number, message: string): boolean {
  if (status === 402) return true;
  return /insufficient|balance|余额|额度|欠费|欠款|用尽|不足|quota\s*(exceeded|not enough)|no\s*quota/i.test(message);
}

// A failure that points at the MODEL/CHANNEL (not the key): "model not found",
// "无可用渠道", "no permission for model". We picked the probe model ourselves,
// so this is our bad pick or a per-model channel gap — it does NOT prove the key
// is dead, so it must not fail the key.
function looksModelIssue(message: string): boolean {
  return /model|模型|渠道|channel|not found|does not exist|no permission|无权|无可用|unavailable/i.test(message);
}

const PROBE_MAX_MODELS = 5; // distinct models to try, family-diverse & cheapest-first
const PROBE_MAX_ATTEMPTS = 6; // hard cap on completion calls per key (models + one transient retry) — bounds subrequests & latency
const PROBE_RETRY_DELAY_MS = 600;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type AttemptClass = "ok" | "drained" | "invalidKey" | "modelIssue" | "transient" | "other";
interface ChatAttempt {
  cls: AttemptClass;
  status: number;
  latency: number;
  error: string;
  model: string;
}

// One real completion call against the OpenAI-compatible /v1/chat/completions
// shape, classified. A "hi" + max_tokens:1 answers in ~1-3s on a healthy channel;
// the 10s cap turns a hung channel into a fast transient.
async function attemptChat(base: string, key: string, model: string): Promise<ChatAttempt> {
  const { status, ok, body, latency, networkError } = await fetchJson(
    `${base}/v1/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": PROBE_UA,
      },
      body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }], max_tokens: 1, stream: false }),
    },
    10000,
  );
  const error = extractMsg(body, status);
  if (networkError) return { cls: "transient", status: 0, latency: 0, error, model }; // 超时/DNS/reset

  // A real OpenAI-compatible completion (stream:false) ALWAYS carries a non-empty
  // choices[] array. Some relays answer HTTP 200 with an ERROR body ("无可用渠道"),
  // so requiring choices[] here is what keeps a 200-wrapped error from showing 可用.
  const hasCompletion = ok && body && typeof body === "object" && Array.isArray(body.choices) && body.choices.length > 0;
  if (hasCompletion) return { cls: "ok", status, latency, error: "", model };

  if (status === 401) return { cls: "invalidKey", status, latency, error, model }; // unauthenticated → key dead
  if (looksDrained(status, error)) return { cls: "drained", status, latency, error, model }; // 402/余额
  // A non-JSON body is a gateway/HTML/challenge PAGE, and any 5xx is a station-
  // side hiccup — both are transient, retry-able, never a key rejection.
  if (typeof body === "string" || status >= 500) return { cls: "transient", status, latency, error, model };
  if (looksModelIssue(error)) return { cls: "modelIssue", status, latency, error, model }; // our model pick, not the key — try another
  if (status === 403) return { cls: "invalidKey", status, latency, error, model }; // forbidden & not model-related → key dead
  return { cls: "other", status, latency, error: error || "上游返回无有效补全", model }; // 200-no-choices / 400 / 404 → this model failed, try another
}

// The same probe against the Anthropic-native Messages shape: POST /v1/messages
// with `x-api-key` + `anthropic-version` (we ALSO send `Authorization: Bearer`, as
// New-API's /v1/messages accepts either). Many "claude" stations are pure
// Anthropic proxies that only answer this path and 403 the OpenAI one, so a good
// claude key needs this shape to be judged 可用. Anthropic requires `max_tokens`;
// we send 1, so a genuine success still spends only ~2 tokens and any failure 0.
async function attemptAnthropic(base: string, key: string, model: string): Promise<ChatAttempt> {
  const { status, ok, body, latency, networkError } = await fetchJson(
    `${base}/v1/messages`,
    {
      method: "POST",
      headers: {
        "x-api-key": key,
        Authorization: `Bearer ${key}`,
        "anthropic-version": "2023-06-01",
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": PROBE_UA,
      },
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
    },
    10000,
  );
  const error = extractMsg(body, status);
  if (networkError) return { cls: "transient", status: 0, latency: 0, error, model };

  // An Anthropic Messages success is HTTP 200 with a `message` object (content[]).
  // An error is HTTP-coded OR a {"type":"error"} body — never count that as 可用.
  const hasCompletion =
    ok && body && typeof body === "object" && body.type !== "error" && (Array.isArray(body.content) || body.type === "message");
  if (hasCompletion) return { cls: "ok", status, latency, error: "", model };

  if (status === 401) return { cls: "invalidKey", status, latency, error, model };
  if (looksDrained(status, error)) return { cls: "drained", status, latency, error, model };
  if (typeof body === "string" || status >= 500) return { cls: "transient", status, latency, error, model }; // HTML gateway page / 5xx / missing endpoint
  if (looksModelIssue(error)) return { cls: "modelIssue", status, latency, error, model };
  if (status === 403) return { cls: "invalidKey", status, latency, error, model };
  return { cls: "other", status, latency, error: error || "上游返回无有效补全", model };
}

// An ordered (endpoint-shape, model) attempt. A "claude" group is very often an
// Anthropic-NATIVE upstream that only answers POST /v1/messages and 403s the
// OpenAI /v1/chat/completions path — the exact false-negative the operator hit
// ("这个是可用的但显示不可用" with an "HTTP 403 非 JSON 页面" on a claude key). So for a
// claude model we try the Anthropic shape FIRST, then the OpenAI-compat shape as
// a fallback for relays that translate. Non-claude models only have the OpenAI shape.
interface ProbeAttempt {
  shape: "openai" | "anthropic";
  model: string;
}

function pickProbeAttempts(models: string[], ratios: ModelRatio[], limit: number): ProbeAttempt[] {
  const candidates = pickProbeModels(models, ratios, limit);
  const specs: ProbeAttempt[] = [];
  for (const model of candidates) {
    if (modelFamily(model) === "claude") {
      specs.push({ shape: "anthropic", model });
      specs.push({ shape: "openai", model });
    } else {
      specs.push({ shape: "openai", model });
    }
  }
  return specs;
}

// Authoritative liveness probe. Walks the cheapest models across BOTH endpoint
// shapes (Anthropic /v1/messages for claude, OpenAI /v1/chat/completions
// otherwise), retrying transient blips and falling back on model/channel errors
// (all 0-token), until either a real completion succeeds (可用), the account is
// proven out of money (无额度), the key is actively rejected (不可用), or the attempt
// budget is spent (不可用). A single rejection can be endpoint/auth-scheme specific
// (OpenAI Bearer vs Anthropic x-api-key), so it does NOT end the probe — only two
// independent rejections (both shapes) prove the key dead. A non-success here is a
// GENUINE failure, not our own noise — so testKey can trust it and never has to
// fall back to "能列模型就算可用".
async function probeChat(base: string, key: string, models: string[], ratios: ModelRatio[]): Promise<ProbeResult> {
  const specs = pickProbeAttempts(models, ratios, PROBE_MAX_MODELS);
  let attempts = 0;
  let retriedTransient = false;
  let last: ChatAttempt | null = null;
  let keyRejection: ChatAttempt | null = null;
  let rejections = 0;

  const run = (spec: ProbeAttempt) =>
    spec.shape === "anthropic" ? attemptAnthropic(base, key, spec.model) : attemptChat(base, key, spec.model);

  for (const spec of specs) {
    if (attempts >= PROBE_MAX_ATTEMPTS) break;
    attempts++;
    let a = await run(spec);
    // One short-delayed retry for a transient blip — at most ONCE across the whole
    // probe, so a flaky edge doesn't fail a good key but we don't burn the budget.
    if (a.cls === "transient" && !retriedTransient && attempts < PROBE_MAX_ATTEMPTS) {
      retriedTransient = true;
      attempts++;
      await delay(PROBE_RETRY_DELAY_MS);
      a = await run(spec);
    }
    last = a;
    if (a.cls === "ok") {
      return { status: a.status, ok: true, latency: a.latency, error: null, drained: false, invalidKey: false, model: a.model };
    }
    if (a.cls === "drained") {
      return { status: a.status, ok: false, latency: a.latency, error: a.error, drained: true, invalidKey: false, model: a.model };
    }
    if (a.cls === "invalidKey") {
      keyRejection = a;
      rejections++;
      // One rejection may just mean this shape/endpoint doesn't accept the key's
      // auth scheme; keep trying the other shape/models. Two rejections = the key
      // is genuinely rejected — stop so a dead key can't burn the whole budget.
      if (rejections >= 2) break;
    }
    // modelIssue / transient / other / first-invalidKey → try the next spec (0 tokens).
  }

  // No success. If a real request was actively rejected → 不可用 with that reason;
  // otherwise the budget was spent on transient/model errors → 不可用.
  const verdict = keyRejection ?? last;
  return {
    status: verdict?.status ?? 0,
    ok: false,
    latency: verdict?.latency ?? 0,
    error: verdict?.error || "真实请求测试未通过",
    drained: false,
    invalidKey: !!keyRejection,
    model: verdict?.model ?? specs[0]?.model ?? "gpt-4o-mini",
  };
}

// ---- Orchestrator ------------------------------------------------------------
export async function testKey(
  baseUrl: string,
  apiKey: string,
  kind: SiteKind,
  groupName: string,
  accessToken = "",
  opts: { balance?: BalanceResult | null } = {},
): Promise<TestResult> {
  const base = normalizeBase(baseUrl);

  // Balance is account-level (one site = one upstream account). A site-wide 测活
  // can fetch it ONCE and pass it in via opts.balance so we don't re-hit the
  // billing endpoint per key — fewer Cloudflare subrequests per invocation.
  const [modelsRes, pricingRes, balanceRes] = await Promise.all([
    fetchModels(base, apiKey),
    fetchPricing(base, apiKey, kind, groupName, accessToken),
    opts.balance != null ? Promise.resolve(opts.balance) : fetchBalance(base, apiKey, kind, accessToken),
  ]);

  const probe = await probeChat(base, apiKey, modelsRes.models, pricingRes.ratios);

  // TRUTHFUL liveness — the operator's hard rule: a key they can't actually use
  // must NEVER show 可用. So the REAL completion probe is authoritative and there
  // is NO "能列模型就算可用" fallback (that was the false-positive path). probeChat
  // has already retried transient blips and tried the key's other cheap models
  // (all at 0 token cost), so a non-success is a genuine failure we can trust:
  //   • real completion succeeded      → 可用
  //   • 402 / out-of-money / balance≤0 → 无额度 (alive, balance pinned to 0)
  //   • anything else (key rejected, 超时, 网关/防护页, 无可用渠道) → 不可用
  const balanceSpent = balanceRes.balance_usd != null && balanceRes.balance_usd <= 0;
  const drained = probe.drained || balanceSpent;

  let alive: boolean;
  let reason: string | null;
  if (probe.ok) {
    alive = true;
    reason = null;
  } else if (drained) {
    alive = true; // 无额度
    reason = null;
  } else {
    alive = false; // real request did not succeed → genuinely 不可用
    reason = probe.error || modelsRes.error;
  }

  let balanceOut = balanceRes.balance_usd;
  if (drained && (balanceOut == null || balanceOut > 0)) balanceOut = 0;

  return {
    alive,
    latency_ms: probe.latency || modelsRes.latency || null,
    http_status: probe.status || modelsRes.status || null,
    error: alive ? null : reason,
    group_ratio: pricingRes.groupRatio,
    model_ratios: pricingRes.ratios,
    models: modelsRes.models,
    balance_usd: balanceOut,
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
