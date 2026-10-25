import type { KeyInput, KeyStatus, Site, SiteBalance, SiteInput } from "./types";

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export class UnauthorizedError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    credentials: "same-origin",
  });

  let body: ApiEnvelope<T> | null = null;
  try {
    body = (await res.json()) as ApiEnvelope<T>;
  } catch {
    body = null;
  }

  if (res.status === 401) throw new UnauthorizedError(body?.error || "未登录");
  if (!res.ok || !body || body.success === false) throw new Error(body?.error || `请求失败 (${res.status})`);
  return body.data as T;
}

const post = (body?: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body ?? {}) });

export interface TestKeyResponse {
  key_id: number;
  site_id?: number;
  skipped: boolean;
  status?: KeyStatus | null;
  balance?: SiteBalance | null;
}

export const api = {
  session: () => request<{ authed: boolean; configured: boolean; edit: boolean }>("/api/session"),
  login: (username: string, password: string) => request<{ ok: boolean }>("/api/login", post({ username, password })),
  logout: () => request<Record<string, never>>("/api/logout", post()),
  unlock: (password: string) => request<{ edit: boolean }>("/api/unlock", post({ password })),
  lock: () => request<{ edit: boolean }>("/api/lock", post()),

  listSites: () => request<Site[]>("/api/sites"),
  createSite: (data: SiteInput) => request<{ id: number }>("/api/sites", post(data)),
  updateSite: (id: number, data: SiteInput) => request<{ id: number }>(`/api/sites/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteSite: (id: number) => request<{ id: number }>(`/api/sites/${id}`, { method: "DELETE" }),

  createKey: (data: KeyInput & { site_id: number }) => request<{ id: number }>("/api/keys", post(data)),
  updateKey: (id: number, data: KeyInput) =>
    request<{ id: number; key_changed: boolean; probe_changed: boolean }>(`/api/keys/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteKey: (id: number) => request<{ id: number }>(`/api/keys/${id}`, { method: "DELETE" }),
  keySecret: (id: number) => request<{ api_key: string }>(`/api/keys/${id}/secret`),

  testKey: (id: number, auto = false) => request<TestKeyResponse>(`/api/test/key/${id}`, post({ auto })),
  pendingTests: () => request<{ key_ids: number[]; day_start: number }>("/api/test/pending"),
  refreshBalance: (siteId: number, force = false) =>
    request<{ site_id: number; balance: SiteBalance | null; cached: boolean }>("/api/balance/refresh", post({ site_id: siteId, force })),
};
