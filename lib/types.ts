/// <reference types="@cloudflare/workers-types" />

// Cloudflare Pages Functions environment bindings.
export interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
  // Single account. APP_PASSWORD is the login password and also the key that
  // unlocks edit mode. APP_PASSWORD2 is an optional second, fully-equivalent
  // password (either one logs in and unlocks editing). ADMIN_USERNAME defaults
  // to "admin" when unset.
  APP_PASSWORD: string;
  APP_PASSWORD2?: string;
  ADMIN_USERNAME?: string;
  // Optional cookie Domain to share the session across apex/www (e.g.
  // "example.com"). Leave unset for *.pages.dev — see cookieDomain() in auth.ts.
  COOKIE_DOMAIN?: string;
}

export type SiteKind = "newapi" | "sub2api" | "openai";

export interface Site {
  id: number;
  name: string;
  base_url: string;
  kind: SiteKind;
  note: string;
  // Optional New-API user "access token". Some stations gate /api/pricing behind
  // login (the relay sk- key gets 401 there); this token reads it. Empty = unused.
  access_token: string;
  // New-API user id, sent as New-Api-User with the access token (newer New-API
  // versions reject user-panel calls without it). Empty = not sent.
  newapi_user_id: string;
  sort: number;
  created_at: number;
  updated_at: number;
}

export interface ApiKey {
  id: number;
  site_id: number;
  label: string;
  group_name: string;
  api_key: string;
  sort: number;
  created_at: number;
  updated_at: number;
  // When the daily auto-test last claimed this key (unix s). See lib/autotest.ts.
  auto_claimed_at: number | null;
}

export interface ModelRatio {
  model: string;
  model_ratio?: number | null;
  completion_ratio?: number | null;
  quota_type?: number | null; // 0 token-based, 1 per-call
  model_price?: number | null;
}

// Verdict of one liveness test (key_status.state).
//   ok       可用     — a real completion came back
//   no_quota 无额度   — the key authenticates, but the account/key has no money or quota left
//   dead     不可用   — the station rejected the key, or no model on it can serve a request
//   error    检测异常 — inconclusive: timeout, gateway page, WAF challenge, upstream rate limit
export type KeyState = "ok" | "no_quota" | "dead" | "error";

export interface ProbeAttemptLog {
  endpoint: string;
  model: string;
  status: number; // HTTP status, 0 = network error / timeout
  outcome: string;
  ms: number;
  note?: string;
}

export interface ProbeSummary {
  model: string | null; // model of the deciding attempt
  endpoint: string | null; // endpoint path of the deciding attempt
  attempts: ProbeAttemptLog[];
}

export interface BalanceResult {
  balance_usd: number | null;
  total_usage_usd: number | null;
  unlimited: boolean; // the key reports "no limit" — the real account balance is unknown
  source: string;
  raw: unknown;
  reachable: boolean; // an authed balance endpoint answered (not a network/auth failure)
  error: string | null;
}

// Result of testing a single key against its upstream station.
export interface TestResult {
  state: KeyState;
  alive: boolean;
  latency_ms: number | null;
  http_status: number | null;
  error: string | null;
  group_ratio: number | null;
  model_ratios: ModelRatio[];
  models: string[];
  balance: BalanceResult;
  balance_fresh: boolean; // fetched during this test (vs. reused from the site cache)
  pricing_source: "pricing" | "sub2api-billing" | "none";
  probe: ProbeSummary;
}

export interface KeyStatusRow {
  key_id: number;
  state: string | null;
  alive: number | null;
  latency_ms: number | null;
  http_status: number | null;
  error: string | null;
  group_ratio: number | null;
  model_ratios: string | null; // JSON ModelRatio[]
  models: string | null; // JSON string[]
  balance_usd: number | null;
  total_usage_usd: number | null;
  balance_raw: string | null;
  pricing_source: string | null;
  probe: string | null; // JSON ProbeSummary
  tested_at: number | null;
}

// Account balance is site-level (one site = one upstream account).
export interface SiteStatusRow {
  site_id: number;
  balance_usd: number | null;
  total_usage_usd: number | null;
  unlimited: number;
  source: string | null;
  error: string | null; // last refresh error (the last good value is kept)
  checked_at: number | null; // last refresh attempt
  ok_at: number | null; // last successful reading
}

// ---- Shapes sent to the frontend. They never carry a full key or token. ----

export interface PublicKeyStatus {
  state: KeyState | null;
  alive: number | null;
  latency_ms: number | null;
  http_status: number | null;
  error: string | null;
  group_ratio: number | null;
  model_ratios: ModelRatio[];
  models: string[];
  balance_usd: number | null;
  total_usage_usd: number | null;
  pricing_source: string | null;
  probe: ProbeSummary | null;
  tested_at: number | null;
}

export interface PublicKey {
  id: number;
  site_id: number;
  label: string;
  group_name: string;
  key_masked: string;
  sort: number;
  created_at: number;
  updated_at: number;
  status: PublicKeyStatus | null;
}

export interface PublicSiteBalance {
  usd: number | null;
  usage_usd: number | null;
  unlimited: boolean;
  source: string | null;
  error: string | null;
  checked_at: number | null;
  ok_at: number | null;
}

export interface PublicSite {
  id: number;
  name: string;
  base_url: string;
  kind: SiteKind;
  note: string;
  has_access_token: boolean;
  newapi_user_id: string;
  sort: number;
  created_at: number;
  updated_at: number;
  balance: PublicSiteBalance | null;
  keys: PublicKey[];
}
