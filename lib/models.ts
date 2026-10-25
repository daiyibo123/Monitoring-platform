import { classifyAuthHint, type Classified, type Shape } from "./classify";
import { httpRequest, readableMessage } from "./net";
import type { ModelRatio, SiteKind, TestResult } from "./types";

// Model listing, pricing / group ratio, and the choice of probe models.

export const META_UA = "relay-monitor/2.0";
const META_TIMEOUT_MS = 12000;

function bearer(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}`, Accept: "application/json", "User-Agent": META_UA };
}

export interface ModelsResult {
  status: number;
  latency: number;
  models: string[];
  error: string | null;
  authHint: Classified | null; // a clear 401/403 verdict about the key from this route
}

function parseModelIds(body: any): string[] {
  const list: any[] = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : [];
  const ids = list.map((m: any) => (typeof m === "string" ? m : m?.id ?? m?.model ?? m?.slug ?? m?.name)).filter(Boolean);
  return Array.from(new Set(ids.map((s: any) => String(s).replace(/^models\//, ""))));
}

// GET /v1/models. Bearer first (New-API / sub2api / OpenAI); a pure Anthropic
// proxy only takes x-api-key, so a 401 is retried that way before we believe it.
export async function fetchModels(base: string, key: string): Promise<ModelsResult> {
  let r = await httpRequest(`${base}/v1/models`, { method: "GET", headers: bearer(key) }, { timeoutMs: META_TIMEOUT_MS });
  if (r.status === 401) {
    const alt = await httpRequest(
      `${base}/v1/models`,
      { method: "GET", headers: { ...bearer(key), "x-api-key": key, "anthropic-version": "2023-06-01" } },
      { timeoutMs: META_TIMEOUT_MS },
    );
    if (alt.ok) r = alt;
  }
  if (r.ok && r.body && typeof r.body === "object") {
    return { status: r.status, latency: r.latency, models: parseModelIds(r.body), error: null, authHint: null };
  }
  return { status: r.status, latency: r.latency, models: [], error: readableMessage(r), authHint: classifyAuthHint(r) };
}

// ---- Pricing / group ratio -------------------------------------------------

export interface PricingResult {
  groupRatio: number | null;
  ratios: ModelRatio[];
  source: TestResult["pricing_source"];
}

// New-API user-panel routes take the access token in a raw Authorization header
// (some forks want Bearer); newer versions also require New-Api-User = user id.
export async function fetchWithUserToken(url: string, token: string, userId = "") {
  const base: Record<string, string> = { Accept: "application/json", "User-Agent": META_UA };
  if (userId) base["New-Api-User"] = userId;
  let r = await httpRequest(url, { method: "GET", headers: { ...base, Authorization: token } }, { timeoutMs: META_TIMEOUT_MS });
  if (r.status === 401 || r.status === 403) {
    r = await httpRequest(url, { method: "GET", headers: { ...base, Authorization: `Bearer ${token}` } }, { timeoutMs: META_TIMEOUT_MS });
  }
  return r;
}

// New-API GET /api/pricing: per-model ratios + a group_ratio map. Some stations
// put it behind login; the site's access token reads it there.
async function fetchNewApiPricing(base: string, key: string, groupName: string, accessToken: string, userId: string): Promise<PricingResult> {
  const url = `${base}/api/pricing`;
  const r = accessToken
    ? await fetchWithUserToken(url, accessToken, userId)
    : await httpRequest(url, { method: "GET", headers: bearer(key) }, { timeoutMs: META_TIMEOUT_MS });
  const body = r.body;
  if (!r.ok || !body || typeof body !== "object") return { groupRatio: null, ratios: [], source: "none" };

  const data: any[] = Array.isArray(body.data) ? body.data : [];
  const ratios: ModelRatio[] = data
    .map((p: any) => ({
      model: String(p.model_name ?? p.model ?? ""),
      model_ratio: typeof p.model_ratio === "number" ? p.model_ratio : null,
      completion_ratio: typeof p.completion_ratio === "number" ? p.completion_ratio : null,
      quota_type: typeof p.quota_type === "number" ? p.quota_type : null,
      model_price: typeof p.model_price === "number" ? p.model_price : null,
    }))
    .filter((x) => x.model);

  let groupRatio: number | null = null;
  const gr = body.group_ratio;
  if (gr && typeof gr === "object") {
    if (groupName && typeof gr[groupName] === "number") groupRatio = gr[groupName];
    else if (typeof gr.default === "number") groupRatio = gr.default;
    else {
      const vals = Object.values(gr).filter((v) => typeof v === "number") as number[];
      if (vals.length === 1) groupRatio = vals[0];
    }
  }
  const found = ratios.length > 0 || groupRatio !== null;
  return { groupRatio, ratios, source: found ? "pricing" : "none" };
}

// sub2api GET /v1/sub2api/billing: the multiplier effective for this key.
async function fetchSub2ApiBilling(base: string, key: string): Promise<PricingResult> {
  const r = await httpRequest(`${base}/v1/sub2api/billing`, { method: "GET", headers: bearer(key) }, { timeoutMs: META_TIMEOUT_MS });
  const b = r.body;
  if (!r.ok || !b || typeof b !== "object") return { groupRatio: null, ratios: [], source: "none" };
  const ratio =
    typeof b.effective_rate_multiplier === "number"
      ? b.effective_rate_multiplier
      : typeof b.resolved_rate_multiplier === "number"
        ? b.resolved_rate_multiplier
        : typeof b.group_rate_multiplier === "number"
          ? b.group_rate_multiplier
          : null;
  return { groupRatio: ratio, ratios: [], source: ratio != null ? "sub2api-billing" : "none" };
}

export async function fetchPricing(
  base: string,
  key: string,
  kind: SiteKind,
  groupName: string,
  accessToken: string,
  userId: string,
): Promise<PricingResult> {
  if (kind === "openai") return { groupRatio: null, ratios: [], source: "none" };
  if (kind === "sub2api") return fetchSub2ApiBilling(base, key);
  return fetchNewApiPricing(base, key, groupName, accessToken, userId);
}

// ---- Probe model selection ---------------------------------------------------

export function modelFamily(model: string): string {
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
  if (/gpt|chatgpt|codex|^o\d/.test(m)) return "openai";
  return "other";
}

// Which request shapes to try for a model, in order.
export function shapesFor(model: string): Shape[] {
  const f = modelFamily(model);
  if (f === "claude") return ["anthropic", "openai"];
  if (f === "openai") return ["openai", "responses"];
  if (f === "gemini") return ["openai", "gemini"];
  return ["openai", "anthropic"];
}

// Models that cannot answer a chat request (embeddings, images, audio, …).
const NON_CHAT =
  /embed|embedding|rerank|moderation|whisper|tts|speech|transcri|audio|realtime|dall-e|dalle|image|imagen|vision-preview|video|veo|sora|kling|seedance|midjourney|mj[-_]|flux|stable-diffusion|sdxl|suno|music|ocr|search-preview|-search$|computer-use/i;

const PREFERRED = [
  "gpt-4o-mini",
  "gpt-4.1-nano",
  "gpt-4.1-mini",
  "gpt-3.5-turbo",
  "gpt-5-nano",
  "gpt-5-mini",
  "claude-haiku-4-5",
  "claude-3-5-haiku",
  "claude-3-haiku",
  "gemini-2.0-flash-lite",
  "gemini-2.0-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-1.5-flash",
  "deepseek-chat",
  "deepseek-v3",
  "qwen-turbo",
  "qwen-plus",
  "glm-4-flash",
  "glm-4.5-air",
  "moonshot-v1-8k",
  "grok-3-mini",
];

const FALLBACK = ["gpt-4o-mini", "claude-haiku-4-5-20251001", "gemini-2.0-flash", "deepseek-chat", "gpt-3.5-turbo", "claude-3-5-haiku-20241022"];

const CHEAP = /mini|nano|flash|lite|haiku|turbo|small|tiny|air|instant|fast|8k|free|micro/i;
const PRICEY = /opus|thinking|reason|deep-research|-pro\b|\bpro\b|max|preview|ultra|o1(?!-mini)|o3(?!-mini)|-high\b/i;
// Special-purpose models (Codex agents, reviewers, routers) often refuse a
// plain chat request; try general chat models first.
const SPECIAL = /codex|review|agent|auto|router|instruct|latest-search/i;

function cheapness(m: string, ratioOf: Map<string, number>): number {
  const lower = m.toLowerCase();
  const idx = PREFERRED.findIndex((p) => lower === p || lower.startsWith(`${p}-`));
  if (idx >= 0) return -1000 + idx;
  const r = ratioOf.get(m);
  if (r != null) return r;
  let score = 500;
  if (CHEAP.test(lower)) score -= 300;
  if (PRICEY.test(lower)) score += 300;
  if (SPECIAL.test(lower)) score += 200;
  return score;
}

// Family-diverse, cheapest-first candidates: a key scoped to one family
// (claude-only / gemini-only …) still gets a model it can use within the budget.
export function pickProbeModels(models: string[], ratios: ModelRatio[], limit: number): string[] {
  const advertised = models.length ? models : ratios.map((r) => r.model).filter(Boolean);
  const chat = advertised.filter((m) => !NON_CHAT.test(m));
  const pool = Array.from(new Set(chat.length ? chat : advertised.length ? advertised : FALLBACK));

  const ratioOf = new Map<string, number>();
  for (const r of ratios) {
    if (r.model && typeof r.model_ratio === "number" && r.model_ratio > 0 && !ratioOf.has(r.model)) ratioOf.set(r.model, r.model_ratio);
  }

  const byFamily = new Map<string, string[]>();
  for (const m of pool) {
    const f = modelFamily(m);
    const arr = byFamily.get(f);
    if (arr) arr.push(m);
    else byFamily.set(f, [m]);
  }
  for (const arr of byFamily.values()) arr.sort((a, b) => cheapness(a, ratioOf) - cheapness(b, ratioOf));
  const families = Array.from(byFamily.values()).sort((a, b) => cheapness(a[0], ratioOf) - cheapness(b[0], ratioOf));

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
  return ranked.length ? ranked : ["gpt-4o-mini"];
}

// Probe order: the models the operator really uses come first (pinned probe
// model, the model that passed last time, the key's own usage stats), then the
// cheap family-diverse picks. A relay often lists models whose channel is down;
// testing the cheapest such model first is how a working key looked broken.
export function orderProbeModels(preferred: string[], models: string[], ratios: ModelRatio[], limit: number): string[] {
  const head = Array.from(new Set(preferred.map((m) => m.trim()).filter(Boolean))).slice(0, limit);
  const rest = pickProbeModels(models, ratios, limit).filter((m) => !head.includes(m));
  return [...head, ...rest].slice(0, limit);
}
