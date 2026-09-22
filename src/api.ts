import type { ModelRatio, Site, SiteKind } from "./types";

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    credentials: "same-origin",
  });

  let body: ApiEnvelope<T> | null = null;
  try {
    body = (await res.json()) as ApiEnvelope<T>;
  } catch {
    body = null;
  }

  if (res.status === 401) {
    throw new UnauthorizedError(body?.error || "未登录");
  }
  if (!res.ok || !body || body.success === false) {
    throw new Error(body?.error || `请求失败 (${res.status})`);
  }
  return body.data as T;
}

export class UnauthorizedError extends Error {}

export interface TestResultPayload {
  alive: boolean;
  latency_ms: number | null;
  http_status: number | null;
  error: string | null;
  group_ratio: number | null;
  model_ratios: ModelRatio[];
  models: string[];
  balance_usd: number | null;
  total_usage_usd: number | null;
  pricing_source: string;
}

export const api = {
  session: () => request<{ authed: boolean; configured: boolean; edit: boolean }>("/api/session"),
  login: (username: string, password: string) =>
    request<{ ok: boolean }>("/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<Record<string, never>>("/api/logout", { method: "POST" }),
  unlock: (password: string) =>
    request<{ edit: boolean }>("/api/unlock", { method: "POST", body: JSON.stringify({ password }) }),
  lock: () => request<{ edit: boolean }>("/api/lock", { method: "POST" }),

  listSites: () => request<Site[]>("/api/sites"),
  createSite: (data: { name: string; base_url: string; kind: SiteKind; note: string }) =>
    request<{ id: number }>("/api/sites", { method: "POST", body: JSON.stringify(data) }),
  updateSite: (id: number, data: { name: string; base_url: string; kind: SiteKind; note: string }) =>
    request<{ id: number }>(`/api/sites/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteSite: (id: number) => request<{ id: number }>(`/api/sites/${id}`, { method: "DELETE" }),

  createKey: (data: { site_id: number; label: string; group_name: string; api_key: string }) =>
    request<{ id: number }>("/api/keys", { method: "POST", body: JSON.stringify(data) }),
  updateKey: (id: number, data: { label: string; group_name: string; api_key: string }) =>
    request<{ id: number }>(`/api/keys/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteKey: (id: number) => request<{ id: number }>(`/api/keys/${id}`, { method: "DELETE" }),

  testKey: (id: number) =>
    request<{ key_id: number; result: TestResultPayload }>(`/api/test/key/${id}`, { method: "POST" }),
  testSite: (id: number) =>
    request<{ site_id: number; results: { key_id: number; result: TestResultPayload }[] }>(
      `/api/test/site/${id}`,
      { method: "POST" },
    ),
  refreshBalance: (siteId?: number) =>
    request<{ results: { key_id: number; balance_usd: number | null; total_usage_usd: number | null }[] }>(
      "/api/balance/refresh",
      { method: "POST", body: JSON.stringify(siteId ? { site_id: siteId } : {}) },
    ),
};
