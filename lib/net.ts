// Low-level HTTP helper for upstream calls. Every request has a hard timeout,
// a capped body size, and an optional early stop for SSE streams, so a slow or
// chatty upstream can never hang a Pages Function invocation.

export interface HttpResult {
  status: number; // 0 = network error / timeout
  ok: boolean;
  body: any; // parsed JSON, or the raw text when it is not JSON
  text: string;
  sse: boolean;
  headers: Headers | null;
  latency: number; // time to response headers
  networkError: boolean;
  timedOut: boolean;
}

export interface HttpOptions {
  timeoutMs?: number;
  maxBytes?: number;
  // Return true to stop reading the body early (used for SSE probes).
  stopEarly?: (textSoFar: string) => boolean;
}

const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_MAX_BYTES = 3_000_000;

async function readCapped(res: Response, maxBytes: number, stopEarly?: (t: string) => boolean): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      text += decoder.decode(value, { stream: true });
      if (bytes >= maxBytes || (stopEarly && stopEarly(text))) {
        reader.cancel().catch(() => {});
        break;
      }
    }
  } catch {
    // Aborted mid-body (timeout): keep what arrived; the caller judges it.
  }
  return text;
}

export async function httpRequest(url: string, init: RequestInit, opts: HttpOptions = {}): Promise<HttpResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const start = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const latency = Date.now() - start;
    const ctype = res.headers.get("content-type") || "";
    const sseHeader = ctype.includes("text/event-stream");
    const text = await readCapped(res, opts.maxBytes ?? DEFAULT_MAX_BYTES, sseHeader ? opts.stopEarly : undefined);
    // Some relays stream SSE under a JSON content-type; detect by shape too.
    const sse = sseHeader || /^\s*(data:|event:|:)/.test(text);
    let body: any = text;
    if (!sse) {
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
    }
    const timedOut = controller.signal.aborted; // the timer fired while the body was still streaming
    return { status: res.status, ok: res.ok, body, text, sse, headers: res.headers, latency, networkError: false, timedOut };
  } catch (e: any) {
    const timedOut = e?.name === "AbortError" || controller.signal.aborted;
    const msg = timedOut ? "请求超时" : String(e?.message || e || "网络错误");
    return { status: 0, ok: false, body: msg, text: msg, sse: false, headers: null, latency: Date.now() - start, networkError: true, timedOut };
  } finally {
    clearTimeout(timer);
  }
}

export function isHtml(text: string): boolean {
  const s = text.trimStart().slice(0, 200).toLowerCase();
  return s.startsWith("<!doctype") || s.startsWith("<html") || s.startsWith("<head") || s.startsWith("<body") || /^<\w/.test(s);
}

// Cloudflare / WAF challenge or block page.
export function isChallenge(r: HttpResult): boolean {
  if (r.headers?.get("cf-mitigated")) return true;
  if (!isHtml(r.text)) return false;
  return /just a moment|challenge-platform|cf-chl|attention required|cf-error-details|captcha|access denied|ddos/i.test(r.text.slice(0, 6000));
}

// Error code + message from any JSON error shape (OpenAI, Anthropic, New-API,
// sub2api, Gemini). Returns "" when the body carries no message.
export function errorParts(body: any): { code: string; message: string } {
  if (!body || typeof body !== "object") return { code: "", message: "" };
  const err = body.error;
  let code = "";
  let message = "";
  if (err && typeof err === "object") {
    code = String(err.code ?? err.type ?? err.status ?? "");
    message = String(err.message ?? err.msg ?? "");
  } else if (typeof err === "string") {
    message = err;
  }
  if (!message) message = String(body.message ?? body.msg ?? body.detail ?? body.error_msg ?? "");
  if (!code) code = String(body.code ?? body.type ?? body.status ?? "");
  if (code === "undefined" || code === "null" || code === "error") code = "";
  return { code, message };
}

// Readable one-line reason for the UI (never raw HTML).
export function readableMessage(r: HttpResult): string {
  if (r.networkError) return r.timedOut ? "请求超时" : `网络错误：${r.text.slice(0, 160)}`;
  if (typeof r.body === "object" && r.body) {
    const { code, message } = errorParts(r.body);
    const m = message || code;
    if (m) return m.slice(0, 300);
  }
  const t = r.text.trim();
  if (t && isHtml(t)) {
    return `上游返回了网页而不是 API 响应（HTTP ${r.status}），通常是网关错误/超时或防护拦截页`;
  }
  if (t && !r.sse) return t.slice(0, 300);
  return `HTTP ${r.status}`;
}

// Hide anything that looks like a secret before it is stored or displayed.
export function redact(s: string): string {
  return s.replace(/\b(sk|pk|rk|ak)-[A-Za-z0-9_\-]{8,}/g, (m) => `${m.slice(0, 6)}…`);
}

export const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Accept a pasted base URL with or without /v1 (or a full endpoint path).
export function normalizeBase(base: string): string {
  let b = base.trim().replace(/\/+$/, "");
  b = b.replace(/\/v1(\/(chat\/completions|completions|messages|responses|models))?$/i, "");
  return b.replace(/\/+$/, "");
}
