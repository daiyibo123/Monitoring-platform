export type SiteKind = "newapi" | "sub2api" | "openai";

// Server verdict of one liveness test.
export type ServerKeyState = "ok" | "no_quota" | "dead" | "error";

export interface ModelRatio {
  model: string;
  model_ratio?: number | null;
  completion_ratio?: number | null;
  quota_type?: number | null;
  model_price?: number | null;
}

export interface ProbeAttempt {
  endpoint: string;
  model: string;
  status: number;
  outcome: string;
  ms: number;
  note?: string;
}

export interface ProbeSummary {
  model: string | null;
  endpoint: string | null;
  attempts: ProbeAttempt[];
}

export interface KeyStatus {
  state: ServerKeyState | null;
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

export interface ApiKey {
  id: number;
  site_id: number;
  label: string;
  group_name: string;
  key_masked: string;
  sort: number;
  created_at: number;
  updated_at: number;
  status: KeyStatus | null;
}

export interface SiteBalance {
  usd: number | null;
  usage_usd: number | null;
  unlimited: boolean;
  source: string | null;
  error: string | null;
  checked_at: number | null;
  ok_at: number | null;
}

export interface Site {
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
  balance: SiteBalance | null;
  keys: ApiKey[];
}

export interface SiteInput {
  name: string;
  base_url: string;
  kind: SiteKind;
  note: string;
  newapi_user_id: string;
  access_token?: string; // omitted = keep
  clear_access_token?: boolean;
}

export interface KeyInput {
  label: string;
  group_name: string;
  api_key?: string; // omitted on edit = keep
}
