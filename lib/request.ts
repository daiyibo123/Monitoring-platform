import type { Shape } from "./classify";

// Builds the minimal real request for each endpoint shape. Every probe sends
// "hi" with the smallest output limit the endpoint accepts, so a genuine
// success costs ~1-2 output tokens and every failure costs 0.

// Claude Code CLI identity. sub2api (and similar relays) can restrict a group
// to Claude Code clients: its validator requires a `claude-cli/x.y.z` UA and
// lets a max_tokens=1 request through without the full system-prompt check.
// A browser UA is rejected there, which made good Claude keys show 不可用.
export const DEFAULT_CC_VERSION = "2.1.0";
const CC_SYSTEM = "You are Claude Code, Anthropic's official CLI for Claude.";

export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const SDK_UA = "OpenAI/Python 1.82.0";

export type UaMode = "native" | "alt";

export interface ProbeRequestOpts {
  tokens: TokenRung;
  stream: boolean;
  ua: UaMode;
  ccVersion: string;
  strict: boolean; // add the full Claude Code header/metadata set
}

export type TokenRung =
  | { param: "max_tokens"; value: number }
  | { param: "max_completion_tokens"; value: number }
  | { param: "max_output_tokens"; value: number }
  | { param: "maxOutputTokens"; value: number }
  | { param: "none" };

// Output-limit fallbacks per shape, tried in order on a "param" rejection.
export const TOKEN_LADDER: Record<Shape, TokenRung[]> = {
  anthropic: [
    { param: "max_tokens", value: 1 },
    { param: "max_tokens", value: 16 },
  ],
  openai: [
    { param: "max_tokens", value: 1 },
    { param: "max_completion_tokens", value: 16 },
    { param: "none" },
  ],
  responses: [{ param: "max_output_tokens", value: 16 }, { param: "none" }],
  gemini: [
    { param: "maxOutputTokens", value: 1 },
    { param: "maxOutputTokens", value: 16 },
  ],
};

function randomHex(bytes: number): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

function applyTokens(body: Record<string, unknown>, t: TokenRung): void {
  if (t.param !== "none" && t.param !== "maxOutputTokens") body[t.param] = t.value;
}

export function buildProbeRequest(shape: Shape, base: string, key: string, model: string, o: ProbeRequestOpts): { url: string; init: RequestInit; path: string } {
  if (shape === "anthropic") {
    const headers: Record<string, string> = {
      "x-api-key": key,
      Authorization: `Bearer ${key}`,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
      Accept: o.stream ? "text/event-stream" : "application/json",
      "User-Agent": o.ua === "native" ? `claude-cli/${o.ccVersion} (external, cli)` : BROWSER_UA,
      "x-app": "cli",
    };
    if (o.strict) headers["anthropic-beta"] = "claude-code-20250219";
    const body: Record<string, unknown> = {
      model,
      messages: [{ role: "user", content: "hi" }],
      system: [{ type: "text", text: CC_SYSTEM }],
      stream: o.stream,
    };
    applyTokens(body, o.tokens);
    if (o.strict) body.metadata = { user_id: `user_${randomHex(32)}_account__session_${crypto.randomUUID()}` };
    return { url: `${base}/v1/messages`, path: "/v1/messages", init: { method: "POST", headers, body: JSON.stringify(body) } };
  }

  if (shape === "gemini") {
    const id = model.replace(/^models\//, "");
    const action = o.stream ? "streamGenerateContent?alt=sse" : "generateContent";
    const generationConfig: Record<string, unknown> = {};
    if (o.tokens.param === "maxOutputTokens") generationConfig.maxOutputTokens = o.tokens.value;
    const headers = {
      "x-goog-api-key": key,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": o.ua === "native" ? BROWSER_UA : SDK_UA,
    };
    const body = { contents: [{ role: "user", parts: [{ text: "hi" }] }], generationConfig };
    const path = `/v1beta/models/${id}:${action}`;
    return { url: `${base}${path}`, path: `/v1beta/models/…:${o.stream ? "streamGenerateContent" : "generateContent"}`, init: { method: "POST", headers, body: JSON.stringify(body) } };
  }

  const path = shape === "responses" ? "/v1/responses" : "/v1/chat/completions";
  const headers = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Accept: o.stream ? "text/event-stream" : "application/json",
    "User-Agent": o.ua === "native" ? BROWSER_UA : SDK_UA,
  };
  const body: Record<string, unknown> =
    shape === "responses" ? { model, input: "hi", stream: o.stream } : { model, messages: [{ role: "user", content: "hi" }], stream: o.stream };
  applyTokens(body, o.tokens);
  return { url: `${base}${path}`, path, init: { method: "POST", headers, body: JSON.stringify(body) } };
}
