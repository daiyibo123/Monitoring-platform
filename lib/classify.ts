import { errorParts, isChallenge, isHtml, readableMessage, type HttpResult } from "./net";

// Turns one upstream response into an outcome the probe can act on. The goal
// is a TRUTHFUL verdict: 可用 only when a real completion came back, and our own
// noise (wrong model pick, wrong endpoint shape, a WAF page, a timeout) must
// never be reported as "the key is dead".

export type Shape = "anthropic" | "openai" | "responses" | "gemini";

export type Outcome =
  | "ok"
  | "drained" // 余额/额度用尽 → 无额度
  | "dead" // the station rejected the key → 不可用
  | "modelIssue" // this model/channel is not available for the key → try another model
  | "endpoint" // this endpoint shape is not served → try another shape
  | "param" // a request parameter was rejected (max_tokens …) → adapt and retry
  | "stream" // the endpoint only accepts stream:true → retry streaming
  | "ccVersion" // Claude Code version gate → retry with the version it asks for
  | "ccOnly" // the group only admits Claude Code clients
  | "rateLimited" // 429 / saturated / concurrency → inconclusive
  | "blocked" // WAF / Cloudflare challenge / IP restriction → inconclusive
  | "upstream" // 5xx from the station: this model's channel failed → try another model
  | "transient" // network error / timeout → retry once, then inconclusive
  | "internal" // our own platform limit (subrequests) → stop, inconclusive
  | "other";

export interface Classified {
  outcome: Outcome;
  message: string;
  version?: string; // ccVersion: the version the gate asks for
  uaFixable?: boolean; // blocked: a bot filter that a different User-Agent may pass
}

const RE_DRAINED =
  /insufficient[\s_-]*(account[\s_-]*)?(balance|quota|credit|fund)|credit balance is too low|exceeded your current quota|insufficient_quota|quota[\s_-]*(exceeded|exhausted|not[\s_]*enough|is[\s_]*not[\s_]*enough|insufficient)|(?<![a-z])no[\s_-]*quota|out of (credit|quota|balance)|not enough (balance|quota|credit)|balance[\s_-]*(is[\s_-]*)?(not enough|insufficient|exhausted|too low)|pre_consume|余额不足|余额已用|余额为负|余额耗尽|额度不足|额度已用|额度用尽|剩余额度|已用尽|欠费|欠款|请充值|预扣费/i;
const RE_USAGE_LIMIT =
  /usage[\s_-]*limit[\s_-]*(exceeded|reached)|(daily|weekly|monthly)[\s_-]*(usage[\s_-]*)?(limit|quota)[\s_-]*(exceeded|reached)|(日|周|月)(用量|额度|限额).{0,4}(已|超|达)|用量(已达|超过|上限)|达到.{0,6}(上限|限额)|超出.{0,6}(限额|额度)/i;
const RE_IP_BLOCK =
  /\bip\b.{0,40}(not allowed|denied|forbidden|whitelist|blocked|restrict)|your ip|ip.{0,6}(不在|未在|受限|禁止|限制)|白名单|地区.{0,6}(不支持|受限)|region.{0,20}(not supported|unsupported)|unsupported_country|country.{0,20}not supported/i;
const RE_KEY_DEAD =
  /invalid[\s_-]*(api[\s_-]*)?(key|token|authentication|x-api-key)|incorrect[\s_-]*(api[\s_-]*)?key|authentication[\s_-]*(failed|error|required)|api[\s_-]*key[\s_-]*(is[\s_-]*)?(disabled|expired|revoked|invalid|required|not[\s_-]*(found|valid))|(?<![_a-z])token[\s_-]*(is[\s_-]*)?(disabled|expired|revoked|invalid)|(?<![_a-z])key[\s_-]*(is[\s_-]*)?(disabled|expired|revoked|invalid)|account[\s_-]*(is[\s_-]*)?(disabled|deactivated|banned|suspended|inactive|not active)|user[\s_-]*(account[\s_-]*)?(is[\s_-]*)?(disabled|banned|inactive|not[\s_-]*(found|active))|no[\s_-]*active[\s_-]*subscription|group[\s_-]*(is[\s_-]*)?(disabled|deleted|not[\s_-]*allowed)|(令牌|密钥|(?<![_a-z])key|(?<![_a-z])token).{0,8}(无效|不存在|已过期|过期|已禁用|禁用|已删除|错误|不可用|已失效)|无效的?(令牌|密钥|key|token)|用户.{0,4}(已被封禁|封禁|已禁用|不存在)|分组.{0,8}(已删除|已停用|不再允许|不存在)|未提供令牌/i;
const RE_MODEL =
  /model[\s_-]*(not[\s_-]*found|does[\s_-]*not[\s_-]*exist|not[\s_-]*(supported|available|allowed|permitted|enabled)|is[\s_-]*not[\s_-]*(supported|available|allowed)|unavailable)|(no|not)[\s_-]*(available|permission|access)[\s_-]*(channel|model)|no[\s_-]*(permission|access)[\s_-]*(to|for)[\s_-]*(the[\s_-]*)?model|unsupported[\s_-]*model|invalid[\s_-]*model|unknown[\s_-]*model|model_not_found|model[\s:]+['"`]?[\w.\-/:]+['"`]?[\s,]*(is[\s_-]*)?(not|does not|unsupported|unavailable)|无可用渠道|没有可用.{0,4}渠道|渠道.{0,6}(不可用|不存在|已禁用)|模型.{0,10}(不存在|不支持|不可用|无权|未开放|未启用|不允许|下线)|(无权|不允许|不支持).{0,8}模型|分组.{0,12}(模型|渠道).{0,6}(不可用|不存在)/i;
const RE_NO_ACCOUNTS = /no available accounts?|暂无可用账号|没有可用账号|无可用账号/i;
const RE_ENDPOINT =
  /invalid url|unknown (url|endpoint|route|path)|no route|route not found|endpoint not (found|supported)|unsupported (endpoint|path|api)|page not found|cannot (post|get) \/|not found: \/|接口不存在|不支持(该|此)?(接口|端点|路径)|路由不存在/i;
const RE_PARAM_TOKENS = /max_tokens|max_completion_tokens|max_output_tokens|maxoutputtokens|max tokens/i;
const RE_PARAM_BAD = /unsupported|not supported|invalid|unknown|unrecognized|not allowed|must be|at least|greater than|minimum|too small|expected|不支持|无效|必须|至少|不能/i;
const RE_STREAM_REQ =
  /stream(ing)?[^.]{0,30}(must be|is required|required)|only (supports? )?stream|must (use|be) stream|requires? stream|仅支持流式|必须.{0,4}流式|只支持流式/i;
const RE_CC_VERSION = /claude[\s-]*code.{0,60}version|version.{0,40}claude[\s-]*code|@anthropic-ai\/claude-code/i;
const RE_CC_ONLY =
  /only (allows?|accepts?|supports?) claude[\s-]*code|claude[\s-]*code (clients? )?only|only .{0,20}claude[\s-]*code client|authorized for use with claude[\s-]*code|(仅|只)(允许|支持).{0,6}claude[\s-]*code|非\s*claude[\s-]*code/i;
const RE_AUTH_ABUSE = /too many invalid auth|invalid_auth_rate_limited|认证失败次数过多/i;
const RE_RATE =
  /rate[\s_-]*limit|too many requests|concurren|overloaded|saturat|capacity|busy|try again later|retry later|请稍后|限流|频率|并发|负载已满|饱和|繁忙|过载|速率|排队/i;
const RE_EMPTY = /empty (response|content|completion|reply)|no content (returned|generated)|空(响应|回复|内容)|返回(内容)?为空/i;
// Text that betrays an error dressed up as an assistant reply.
const RE_SMUGGLED = /insufficient|balance|quota|余额|额度|无可用|invalid|unauthor|error|错误|失败|denied|forbidden|limit/i;

function wantedVersion(text: string): string | undefined {
  const m = text.match(/(?:minimum|maximum|at least|最低|最高|需要|required)[^0-9]{0,40}(\d+\.\d+\.\d+)/i);
  if (m) return m[1];
  const all = text.match(/\d+\.\d+\.\d+/g);
  return all ? all[all.length - 1] : undefined;
}

export function classifyError(status: number, code: string, msg: string, r: HttpResult): Classified {
  if (typeof r.body === "string" && isHtml(r.text)) {
    if (isChallenge(r) || status === 403) {
      return { outcome: "blocked", message: "被站点防护拦截（Cloudflare/WAF 挑战页）", uaFixable: !r.headers?.get("cf-mitigated") };
    }
    if (status === 200 || status === 404 || status === 405) return { outcome: "endpoint", message: `该接口不存在（HTTP ${status} 返回网页）` };
    return { outcome: status >= 500 ? "upstream" : "other", message: readableMessage(r) };
  }
  const text = `${code} ${msg}`.trim();
  const display = (msg || code || readableMessage(r)).slice(0, 300);

  if (RE_AUTH_ABUSE.test(text)) return { outcome: "blocked", message: "上游因认证失败次数过多临时封禁了检测 IP，请稍后再测" };
  if (status === 402 || RE_DRAINED.test(text) || RE_USAGE_LIMIT.test(text)) return { outcome: "drained", message: display };
  if (RE_CC_VERSION.test(text) && /version|版本/i.test(text)) return { outcome: "ccVersion", message: display, version: wantedVersion(text) };
  if (RE_CC_ONLY.test(text)) return { outcome: "ccOnly", message: display };
  if (RE_IP_BLOCK.test(text)) return { outcome: "blocked", message: `IP/地区受限：${display}` };
  if ((status === 400 || status === 422) && RE_PARAM_TOKENS.test(text) && RE_PARAM_BAD.test(text)) return { outcome: "param", message: display };
  if ((status === 400 || status === 422) && RE_STREAM_REQ.test(text)) return { outcome: "stream", message: display };
  if (RE_KEY_DEAD.test(text)) return { outcome: "dead", message: display };
  if (status === 401) return { outcome: "dead", message: display || "HTTP 401 未授权" };
  if (RE_NO_ACCOUNTS.test(text)) {
    return /model|模型/i.test(text) ? { outcome: "modelIssue", message: display } : { outcome: "rateLimited", message: display };
  }
  // Thinking models given 1 output token may come back "empty"; a larger
  // limit on the token ladder fixes that, so treat it as a parameter problem.
  if (RE_EMPTY.test(text)) return { outcome: "param", message: display };
  if (RE_ENDPOINT.test(text)) return { outcome: "endpoint", message: display };
  if (RE_MODEL.test(text)) return { outcome: "modelIssue", message: display };
  if (status === 404 || status === 405) return /model|模型/i.test(text) ? { outcome: "modelIssue", message: display } : { outcome: "endpoint", message: display };
  if (status === 429 || RE_RATE.test(text)) return { outcome: "rateLimited", message: display };
  // The station answered, but this model's upstream failed ("Upstream service
  // temporarily unavailable", a bare "error code: 502"…): another model may work.
  if (status >= 500) return { outcome: "upstream", message: display };
  if (status === 403) return { outcome: "dead", message: display || "HTTP 403 拒绝访问" };
  return { outcome: "other", message: display || "上游返回无有效补全" };
}

function classifyNetwork(r: HttpResult): Classified {
  if (/subrequest/i.test(r.text)) return { outcome: "internal", message: "本次检测的子请求数超出 Cloudflare 上限" };
  return { outcome: "transient", message: r.timedOut ? "请求超时" : `网络错误：${r.text.slice(0, 160)}` };
}

function contentText(shape: Shape, body: any): string {
  try {
    if (shape === "openai") {
      const m = body.choices?.[0]?.message ?? body.choices?.[0]?.delta;
      return typeof m?.content === "string" ? m.content : "";
    }
    if (shape === "anthropic") {
      return Array.isArray(body.content) ? body.content.map((c: any) => (typeof c?.text === "string" ? c.text : "")).join("") : "";
    }
    if (shape === "responses") {
      if (typeof body.output_text === "string") return body.output_text;
      const out: any[] = Array.isArray(body.output) ? body.output : [];
      return out
        .flatMap((o) => (Array.isArray(o?.content) ? o.content : []))
        .map((c: any) => (typeof c?.text === "string" ? c.text : ""))
        .join("");
    }
    const parts = body.candidates?.[0]?.content?.parts;
    return Array.isArray(parts) ? parts.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("") : "";
  } catch {
    return "";
  }
}

function completionShape(shape: Shape, body: any): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  if (shape === "openai") return !body.error && Array.isArray(body.choices) && body.choices.length > 0;
  if (shape === "anthropic") return body.type !== "error" && !body.error && (body.type === "message" || Array.isArray(body.content));
  if (shape === "responses") return (body.object === "response" || Array.isArray(body.output)) && body.status !== "failed" && !body.error;
  return !body.error && Array.isArray(body.candidates) && body.candidates.length > 0;
}

// Scan an SSE body: did real generation start, or did the stream carry an error?
export function sseVerdict(text: string): { kind: "ok" | "error" | "none"; code: string; message: string } {
  let eventName = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
      continue;
    }
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    let j: any;
    try {
      j = JSON.parse(data);
    } catch {
      continue;
    }
    const t: string = typeof j?.type === "string" ? j.type : eventName;
    if (t === "error" || t === "response.failed" || t === "response.error" || (j?.error && !j?.choices)) {
      const { code, message } = errorParts({ error: j?.response?.error ?? j?.error ?? j });
      return { kind: "error", code, message: message || code || "流式响应返回错误" };
    }
    if (t === "ping") continue;
    if (Array.isArray(j?.choices) && j.choices.length) return { kind: "ok", code: "", message: "" };
    if (t === "content_block_start" || t === "content_block_delta" || t === "message_delta" || t === "message_stop") {
      return { kind: "ok", code: "", message: "" };
    }
    if (t.startsWith("response.output") || t.startsWith("response.content_part") || t === "response.completed") {
      return { kind: "ok", code: "", message: "" };
    }
    if (Array.isArray(j?.candidates) && j.candidates.length) return { kind: "ok", code: "", message: "" };
  }
  return { kind: "none", code: "", message: "" };
}

export function classifyResponse(shape: Shape, r: HttpResult): Classified {
  if (r.networkError) return classifyNetwork(r);
  if (r.sse) {
    const v = sseVerdict(r.text);
    if (v.kind === "ok" && r.status < 400) return { outcome: "ok", message: "" };
    if (v.kind === "error") return classifyError(r.status >= 400 ? r.status : 200, v.code, v.message, r);
    if (r.status >= 400) return classifyError(r.status, "", "", r);
    return r.timedOut ? { outcome: "transient", message: "流式响应超时（未收到任何内容）" } : { outcome: "other", message: "流式响应中没有有效内容" };
  }
  if (r.ok && completionShape(shape, r.body)) {
    // With max_tokens:1 a real reply is a token or two. A longer "reply" that
    // reads as a known error is a relay smuggling its error into a 200.
    const t = contentText(shape, r.body);
    if (t.length > 8 && RE_SMUGGLED.test(t)) {
      const c = classifyError(200, "", t, r);
      if (c.outcome === "drained" || c.outcome === "dead" || c.outcome === "modelIssue") return c;
    }
    return { outcome: "ok", message: "" };
  }
  const { code, message } = errorParts(r.body);
  return classifyError(r.status, code, message, r);
}

// What a failed GET /v1/models says about the key. Only clear JSON answers
// count; an HTML/WAF page proves nothing about the key.
export function classifyAuthHint(r: HttpResult): Classified | null {
  if (r.networkError || r.ok) return null;
  if (r.status !== 401 && r.status !== 402 && r.status !== 403) return null;
  if (!r.body || typeof r.body !== "object") return null;
  const { code, message } = errorParts(r.body);
  const c = classifyError(r.status, code, message, r);
  return c.outcome === "drained" || c.outcome === "dead" ? c : null;
}
