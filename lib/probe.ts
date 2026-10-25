import { classifyResponse, sseVerdict, type Classified, type Outcome, type Shape } from "./classify";
import { pickProbeModels, shapesFor } from "./models";
import { delay, httpRequest, redact } from "./net";
import { buildProbeRequest, DEFAULT_CC_VERSION, TOKEN_LADDER, type UaMode } from "./request";
import type { KeyState, ModelRatio, ProbeAttemptLog, ProbeSummary } from "./types";

// The authoritative liveness probe: 可用 means a real completion came back,
// nothing less. It walks cheap, family-diverse models across the endpoint shapes
// a relay may serve (Anthropic /v1/messages, OpenAI chat/responses, Gemini) and
// adapts to fixable rejections (output-limit parameter, stream-only, Claude Code
// version/identity gates, bot filters) at zero token cost. Only a genuine
// success generates tokens. Whatever it cannot settle is reported as 检测异常,
// never as 不可用 — so our own noise is never blamed on the key.

const PROBE_DEADLINE_MS = 45000;
const ATTEMPT_TIMEOUT_MS = 15000;
const MIN_ATTEMPT_MS = 3000;
const MAX_CALLS = 10;
const MAX_MODELS = 4;
const RETRY_DELAY_MS = 700;

export interface ProbeOutcome {
  state: KeyState;
  ok: boolean;
  rejected: boolean; // the station actively rejected the key
  error: string | null;
  status: number | null;
  latency: number | null;
  summary: ProbeSummary;
}

interface Run {
  c: Classified;
  status: number;
  latency: number;
  path: string;
  model: string;
}

const INCONCLUSIVE_ORDER: Outcome[] = ["blocked", "ccOnly", "ccVersion", "rateLimited", "internal", "param", "stream", "transient", "other"];

function describe(run: Run): string {
  const m = run.c.message;
  switch (run.c.outcome) {
    case "rateLimited":
      return `上游限流或繁忙：${m}`;
    case "transient":
      return `上游超时或网关错误：${m}`;
    case "ccOnly":
      return `该分组仅允许 Claude Code 客户端，检测请求未被放行：${m}`;
    case "ccVersion":
      return `Claude Code 版本校验未通过：${m}`;
    case "param":
      return `上游不接受检测请求的参数：${m}`;
    case "stream":
      return `上游要求流式请求：${m}`;
    default:
      return m;
  }
}

export async function probeKey(
  base: string,
  key: string,
  models: string[],
  ratios: ModelRatio[],
  hint: Classified | null,
  deadlineAt = Infinity,
): Promise<ProbeOutcome> {
  const deadline = Math.min(deadlineAt, Date.now() + PROBE_DEADLINE_MS);
  const attempts: ProbeAttemptLog[] = [];
  let calls = 0;
  let ccVersion = DEFAULT_CC_VERSION;
  let retriedTransient = false;
  const canCall = () => calls < MAX_CALLS && deadline - Date.now() > MIN_ATTEMPT_MS;

  const result = (state: KeyState, run: Run | null, error: string | null, rejected: boolean): ProbeOutcome => ({
    state,
    ok: state === "ok",
    rejected,
    error: error ? redact(error).slice(0, 400) : null,
    status: run?.status ?? null,
    latency: state === "ok" ? (run?.latency ?? null) : null,
    summary: { model: run?.model ?? null, endpoint: run?.path ?? null, attempts: attempts.slice(-12) },
  });

  async function once(shape: Shape, model: string, tokenIdx: number, stream: boolean, ua: UaMode, strict: boolean): Promise<Run> {
    calls++;
    const tokens = TOKEN_LADDER[shape][tokenIdx];
    const req = buildProbeRequest(shape, base, key, model, { tokens, stream, ua, ccVersion, strict });
    const r = await httpRequest(req.url, req.init, {
      timeoutMs: Math.min(ATTEMPT_TIMEOUT_MS, Math.max(1000, deadline - Date.now())),
      maxBytes: 262144,
      stopEarly: (t) => sseVerdict(t).kind !== "none",
    });
    const c = classifyResponse(shape, r);
    attempts.push({ endpoint: req.path, model, status: r.status, outcome: c.outcome, ms: r.latency, note: c.outcome === "ok" ? undefined : redact(c.message).slice(0, 140) });
    return { c, status: r.status, latency: r.latency, path: req.path, model };
  }

  // One shape+model, adapting to the rejections we know how to fix.
  async function combo(shape: Shape, model: string): Promise<Run | null> {
    let tokenIdx = 0;
    let stream = false;
    let ua: UaMode = "native";
    let strict = false;
    let versionTried = false;
    let last: Run | null = null;
    for (let step = 0; step < 4 && canCall(); step++) {
      last = await once(shape, model, tokenIdx, stream, ua, strict);
      const { outcome, version, uaFixable } = last.c;
      if (outcome === "param" && tokenIdx + 1 < TOKEN_LADDER[shape].length) tokenIdx++;
      else if (outcome === "stream" && !stream) stream = true;
      else if (outcome === "ccVersion" && version && !versionTried && version !== ccVersion) {
        versionTried = true;
        ccVersion = version;
      } else if (outcome === "ccOnly" && shape === "anthropic" && !strict) strict = true;
      else if (outcome === "blocked" && uaFixable && ua === "native") ua = "alt";
      else if (outcome === "transient" && !retriedTransient && last.latency < 8000) {
        retriedTransient = true;
        await delay(RETRY_DELAY_MS);
      } else break;
    }
    return last;
  }

  let rejections = hint?.outcome === "dead" ? 1 : 0;
  let firstRejection: Run | null = null;
  let blocked = 0;
  let last: Run | null = null;
  const definitive: Run[] = [];
  const inconclusive: Run[] = [];

  outer: for (const model of pickProbeModels(models, ratios, MAX_MODELS)) {
    for (const shape of shapesFor(model)) {
      if (!canCall()) break outer;
      const run = await combo(shape, model);
      if (!run) break outer;
      last = run;
      const o = run.c.outcome;
      if (o === "ok") return result("ok", run, null, false);
      if (o === "drained") return result("no_quota", run, run.c.message, false);
      if (o === "dead") {
        firstRejection ??= run;
        if (++rejections >= 2) break outer;
      } else if (o === "modelIssue") {
        definitive.push(run);
        continue outer; // same model on another shape hits the same channel
      } else if (o === "endpoint" || o === "other") {
        definitive.push(run);
      } else {
        inconclusive.push(run);
        if (o === "internal" || (o === "blocked" && ++blocked >= 2) || inconclusive.length >= 4) break outer;
        if (o === "ccOnly") continue outer;
      }
    }
  }

  if (firstRejection && (rejections >= 2 || inconclusive.length === 0)) {
    return result("dead", firstRejection, `Key 被拒绝：${firstRejection.c.message}`, true);
  }
  if (!inconclusive.length && definitive.length) {
    const d = definitive[definitive.length - 1];
    const allModel = definitive.every((r) => r.c.outcome === "modelIssue");
    const tried = new Set(definitive.map((r) => r.model)).size;
    return result("dead", d, allModel ? `没有可用的模型/渠道（已试 ${tried} 个模型）：${d.c.message}` : d.c.message, false);
  }
  if (inconclusive.length) {
    const pick = INCONCLUSIVE_ORDER.map((o) => inconclusive.find((r) => r.c.outcome === o)).find(Boolean) ?? inconclusive[0];
    const extra = firstRejection ? `；另有一次拒绝：${firstRejection.c.message}` : "";
    return result("error", pick, describe(pick) + extra, false);
  }
  return result("error", last, "检测超时：未在时限内得到结论", false);
}
