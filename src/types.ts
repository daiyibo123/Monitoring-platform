export type SiteKind = "newapi" | "sub2api" | "openai";

export interface ModelRatio {
  model: string;
  model_ratio?: number | null;
  completion_ratio?: number | null;
  quota_type?: number | null;
  model_price?: number | null;
}

export interface KeyStatus {
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
  status: KeyStatus | null;
}

export interface Site {
  id: number;
  name: string;
  base_url: string;
  kind: SiteKind;
  note: string;
  sort: number;
  created_at: number;
  updated_at: number;
  keys: ApiKey[];
}
