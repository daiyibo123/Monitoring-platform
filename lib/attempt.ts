import { classifyResponse, sseVerdict, type Classified, type Shape } from "./classify";
import { delay, httpRequest, redact } from "./net";
import { buildProbeRequest, DEFAULT_CC_VERSION, TOKEN_LADDER, type UaMode } from "./request";
import type { ProbeAttemptLog } from "./types";

// Sends probe requests within one key test's budget (calls + deadline) and
// adapts a single endpoint shape + model to the rejections we know how to fix.

const ATTEMPT_TIMEOUT_MS = 15000;
const MIN_ATTEMPT_MS = 3000;
const RETRY_DELAY_MS = 700;
const RATE_RETRY_MAX_MS = 3000;

export interface Run {
  c: Classified;
  status: number;
  latency: number;
  path: string;
  model: string;
  shape: Shape;
  retryAfterMs: number | null;
}

export class ProbeRunner {
  readonly attempts: ProbeAttemptLog[] = [];
  private calls = 0;
  private ccVersion = DEFAULT_CC_VERSION;
  private retriedNetwork = false;

  constructor(
    private readonly base: string,
    private readonly key: string,
    private readonly deadline: number,
    private readonly maxCalls: number,
  ) {}

  canCall(): boolean {
    return this.calls < this.maxCalls && this.deadline - Date.now() > MIN_ATTEMPT_MS;
  }

  private async once(shape: Shape, model: string, tokenIdx: number, stream: boolean, ua: UaMode, strict: boolean): Promise<Run> {
    this.calls++;
    const tokens = TOKEN_LADDER[shape][tokenIdx];
    const req = buildProbeRequest(shape, this.base, this.key, model, { tokens, stream, ua, ccVersion: this.ccVersion, strict });
    const r = await httpRequest(req.url, req.init, {
      timeoutMs: Math.min(ATTEMPT_TIMEOUT_MS, Math.max(1000, this.deadline - Date.now())),
      maxBytes: 262144,
      stopEarly: (t) => sseVerdict(t).kind !== "none",
    });
    let c = classifyResponse(shape, r);
    // A "Claude Code only" answer on a non-Anthropic path only says this path is
    // wrong for the group; the Anthropic shape carries the Claude Code identity.
    if (c.outcome === "ccOnly" && shape !== "anthropic") c = { ...c, outcome: "endpoint" };
    const ra = Number(r.headers?.get("retry-after"));
    this.attempts.push({ endpoint: req.path, model, status: r.status, outcome: c.outcome, ms: r.latency, note: c.outcome === "ok" ? undefined : redact(c.message).slice(0, 140) });
    return { c, status: r.status, latency: r.latency, path: req.path, model, shape, retryAfterMs: Number.isFinite(ra) && ra > 0 ? ra * 1000 : null };
  }

  // One shape + model, adapting to fixable rejections (output-limit parameter,
  // stream-only, Claude Code version/identity, bot filter, one short retry).
  async combo(shape: Shape, model: string): Promise<Run | null> {
    let tokenIdx = 0;
    let stream = false;
    let ua: UaMode = "native";
    let strict = false;
    let versionTried = false;
    let rateRetried = false;
    let last: Run | null = null;
    for (let step = 0; step < 4 && this.canCall(); step++) {
      last = await this.once(shape, model, tokenIdx, stream, ua, strict);
      const { outcome, version, uaFixable } = last.c;
      if (outcome === "param" && tokenIdx + 1 < TOKEN_LADDER[shape].length) tokenIdx++;
      else if (outcome === "stream" && !stream) stream = true;
      else if (outcome === "ccVersion" && version && !versionTried && version !== this.ccVersion) {
        versionTried = true;
        this.ccVersion = version;
      } else if (outcome === "ccOnly" && shape === "anthropic" && !strict) strict = true;
      else if (outcome === "blocked" && uaFixable && ua === "native") ua = "alt";
      else if (outcome === "transient" && !this.retriedNetwork && last.latency < 8000) {
        this.retriedNetwork = true;
        await delay(RETRY_DELAY_MS);
      } else if (outcome === "rateLimited" && !rateRetried) {
        // Shared relay accounts throttle briefly; one patient retry, no more.
        rateRetried = true;
        const wait = Math.min(RATE_RETRY_MAX_MS, last.retryAfterMs ?? 2000);
        if (this.deadline - Date.now() < wait + MIN_ATTEMPT_MS) break;
        await delay(wait);
      } else break;
    }
    return last;
  }
}
