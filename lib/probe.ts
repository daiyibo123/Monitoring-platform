import type { Classified, Outcome, Shape } from "./classify";
import { orderProbeModels, shapesFor } from "./models";
import { redact } from "./net";
import { ProbeRunner, type Run } from "./attempt";
import type { KeyState, ModelRatio, ProbeSummary } from "./types";

// The authoritative liveness probe: 可用 means a real completion came back,
// nothing less. Models the operator really uses go first (pinned model, the one
// that passed last time, the key's usage stats), then cheap family-diverse
// picks. A model whose upstream fails (5xx) is skipped for the next model —
// relays often list models whose channel is down, and testing such a model
// must not make a working key look broken. Whatever cannot be settled is
// reported as 检测异常, never as 不可用.

const PROBE_DEADLINE_MS = 45000;
const MAX_CALLS = 16;
const MAX_MODELS = 8;

export interface ProbeOutcome {
  state: KeyState;
  ok: boolean;
  rejected: boolean; // the station actively rejected the key
  error: string | null;
  status: number | null;
  latency: number | null;
  summary: ProbeSummary;
}

export interface ProbeInput {
  models: string[];
  ratios: ModelRatio[];
  preferred: string[]; // pinned / last good / really used models, in order
  hint: Classified | null; // what GET /v1/models said about the key
  deadlineAt?: number;
}

const INCONCLUSIVE_ORDER: Outcome[] = ["blocked", "ccOnly", "ccVersion", "rateLimited", "internal", "upstream", "transient", "param", "stream", "other"];

function describe(run: Run, tried: number): string {
  const m = run.c.message;
  switch (run.c.outcome) {
    case "upstream":
      return `上游暂时不可用（已试 ${tried} 个模型）：${m}`;
    case "rateLimited":
      return `上游限流或繁忙：${m}`;
    case "transient":
      return `连接上游失败（超时或网络错误）：${m}`;
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

type Step = "next" | "nextModel" | "stop" | "done";

export async function probeKey(base: string, key: string, input: ProbeInput): Promise<ProbeOutcome> {
  const deadline = Math.min(input.deadlineAt ?? Infinity, Date.now() + PROBE_DEADLINE_MS);
  const runner = new ProbeRunner(base, key, deadline, MAX_CALLS);
  const st = {
    rejections: input.hint?.outcome === "dead" ? 1 : 0,
    firstRejection: null as Run | null,
    blocked: 0,
    network: 0,
    definitive: [] as Run[],
    inconclusive: [] as Run[],
    retry: [] as Array<{ model: string; shapes: Shape[] }>,
    final: null as ProbeOutcome | null,
    last: null as Run | null,
  };

  const result = (state: KeyState, run: Run | null, error: string | null, rejected: boolean): ProbeOutcome => ({
    state,
    ok: state === "ok",
    rejected,
    error: error ? redact(error).slice(0, 400) : null,
    status: run?.status ?? null,
    latency: state === "ok" ? (run?.latency ?? null) : null,
    summary: { model: run?.model ?? null, endpoint: run?.path ?? null, attempts: runner.attempts.slice(-14) },
  });

  function judge(run: Run): Step {
    st.last = run;
    switch (run.c.outcome) {
      case "ok":
        st.final = result("ok", run, null, false);
        return "done";
      case "drained":
        st.final = result("no_quota", run, run.c.message, false);
        return "done";
      case "dead":
        st.firstRejection ??= run;
        return ++st.rejections >= 2 ? "stop" : "next";
      case "modelIssue":
        st.definitive.push(run);
        return "nextModel";
      case "upstream":
        st.inconclusive.push(run);
        return "nextModel";
      case "endpoint":
      case "other":
        st.definitive.push(run);
        return "next";
      case "blocked":
        st.inconclusive.push(run);
        return ++st.blocked >= 2 ? "stop" : "next";
      case "transient":
        st.inconclusive.push(run);
        return ++st.network >= 2 ? "stop" : "nextModel";
      default:
        // internal / ccOnly / ccVersion / rateLimited / param / stream: affects
        // the whole key or group — another model would only repeat it.
        st.inconclusive.push(run);
        return "stop";
    }
  }

  const order = orderProbeModels(input.preferred, input.models, input.ratios, MAX_MODELS);
  // Pass 1: each model on its own shapes; a failing upstream skips to the next model.
  pass1: for (const model of order) {
    const shapes = shapesFor(model);
    for (let i = 0; i < shapes.length; i++) {
      if (!runner.canCall()) break pass1;
      const run = await runner.combo(shapes[i], model);
      if (!run) break pass1;
      const step = judge(run);
      if (step === "done") return st.final!;
      if (step === "stop") break pass1;
      if (step === "nextModel") {
        if (run.c.outcome === "upstream" && i + 1 < shapes.length) st.retry.push({ model, shapes: shapes.slice(i + 1) });
        continue pass1;
      }
    }
  }
  // Pass 2: budget left — the other endpoint shape of models whose upstream failed.
  pass2: for (const { model, shapes } of st.retry.slice(0, 2)) {
    for (const shape of shapes) {
      if (!runner.canCall() || st.rejections >= 2 || st.blocked >= 2 || st.network >= 2) break pass2;
      const run = await runner.combo(shape, model);
      if (!run) break pass2;
      const step = judge(run);
      if (step === "done") return st.final!;
      if (step === "stop") break pass2;
    }
  }

  const tried = new Set(runner.attempts.map((a) => a.model)).size;
  const rejection = st.firstRejection;
  if (rejection && (st.rejections >= 2 || st.inconclusive.length === 0)) {
    return result("dead", rejection, `Key 被拒绝：${rejection.c.message}`, true);
  }
  if (!st.inconclusive.length && st.definitive.length) {
    const d = st.definitive[st.definitive.length - 1];
    const allModel = st.definitive.every((r) => r.c.outcome === "modelIssue");
    return result("dead", d, allModel ? `没有可用的模型/渠道（已试 ${tried} 个模型）：${d.c.message}` : d.c.message, false);
  }
  if (st.inconclusive.length) {
    const pick = INCONCLUSIVE_ORDER.map((o) => st.inconclusive.find((r) => r.c.outcome === o)).find(Boolean) ?? st.inconclusive[0];
    const extra = rejection ? `；另有一次拒绝：${rejection.c.message}` : "";
    return result("error", pick, describe(pick, tried) + extra, false);
  }
  return result("error", st.last, "检测超时：未在时限内得到结论", false);
}
