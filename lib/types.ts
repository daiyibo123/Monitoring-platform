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
}

export type SiteKind = "newapi" | "sub2api" | "openai";

export interface Site {
  id: number;
  name: string;
  base_url: string;
  kind: SiteKind;
  note: string;
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
}

export interface ModelRatio {
  model: string;
  model_ratio?: number | null;
  completion_ratio?: number | null;
  quota_type?: number | null; // 0 token-based, 1 per-call
  model_price?: number | null;
}

export interface KeyStatus {
  key_id: number;
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
  tested_at: number | null;
}

// Shape returned to the frontend (status JSON fields parsed).
export interface KeyWithStatus extends ApiKey {
  status: {
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
    tested_at: number | null;
  } | null;
}

export interface SiteWithKeys extends Site {
  keys: KeyWithStatus[];
}

// Result of testing a single key against its upstream station.
export interface TestResult {
  alive: boolean;
  latency_ms: number | null;
  http_status: number | null;
  error: string | null;
  group_ratio: number | null;
  model_ratios: ModelRatio[];
  models: string[];
  balance_usd: number | null;
  total_usage_usd: number | null;
  balance_raw: unknown;
  pricing_source: "pricing" | "sub2api-billing" | "none";
}
