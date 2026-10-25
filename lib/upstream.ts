import { fetchBalance } from "./balance";
import { fetchModels, fetchPricing, type ModelsResult, type PricingResult } from "./models";
import { delay, normalizeBase, redact } from "./net";
import { probeKey, type ProbeOutcome } from "./probe";
import type { BalanceResult, Site, TestResult } from "./types";

// One key test. GET /v1/models goes first: when it already says the key is
// invalid, pricing and balance are skipped and one real request confirms it —
// every call with a dead key is a failed login on the relay, and relays
// rate-limit those per IP (Cloudflare Workers share their egress IPs, so that
// limit would then hit the operator's good keys too). Otherwise pricing and
// balance run alongside the real-request probe. Runs server-side inside Pages
// Functions: no browser CORS, and keys never reach the client.

type SiteLike = Pick<Site, "base_url" | "kind" | "access_token" | "newapi_user_id">;

export interface ProbeHints {
  pinned?: string; // the key's probe_model
  lastOk?: string; // the model that passed the previous test
}

// Hard cap for one whole key test, so a dashboard request always returns.
const TEST_DEADLINE_MS = 55000;
// sub2api usage stats tell which models the key really serves; wait briefly.
const USAGE_WAIT_MS = 4000;
const NO_PRICING: PricingResult = { groupRatio: null, ratios: [], source: "none" };
const SKIPPED: BalanceResult = { balance_usd: null, total_usage_usd: null, unlimited: false, source: "none", raw: null, reachable: false, error: "Key 无效，未读取余额" };

export async function testKey(
  site: SiteLike,
  apiKey: string,
  groupName: string,
  cachedBalance: BalanceResult | null = null,
  hints: ProbeHints = {},
): Promise<TestResult> {
  const deadline = Date.now() + TEST_DEADLINE_MS;
  const base = normalizeBase(site.base_url);
  const pricingOf = () => fetchPricing(base, apiKey, site.kind, groupName, site.access_token, site.newapi_user_id);
  const models = await fetchModels(base, apiKey);
  const pinned = [hints.pinned, hints.lastOk].filter((m): m is string => !!m);

  if (models.authHint?.outcome === "dead") {
    const probe = await probeKey(base, apiKey, { models: [], ratios: [], preferred: pinned, hint: models.authHint, deadlineAt: deadline });
    if (!probe.ok) return finish(probe, models, NO_PRICING, cachedBalance ?? SKIPPED, false);
    // /v1/models refused a key that serves real requests: read the rest normally.
    const [pricing, balance] = await Promise.all([pricingOf(), cachedBalance ? Promise.resolve(cachedBalance) : fetchBalance(base, apiKey, site)]);
    return finish(probe, models, pricing, balance, !cachedBalance);
  }

  // sub2api's /v1/usage is one cheap call that also lists the models this key
  // really used, so it is always read fresh for a sub2api key.
  const wantUsage = site.kind === "sub2api";
  const useCache = Boolean(cachedBalance) && !wantUsage;
  const balanceP = useCache ? Promise.resolve(cachedBalance as BalanceResult) : fetchBalance(base, apiKey, site);
  const pricingP = pricingOf();

  let probe: ProbeOutcome;
  if (models.authHint?.outcome === "drained") {
    // /v1/models passes the same auth + billing gate as a completion, so a clear
    // "out of balance" there is final and saves the probe calls.
    probe = drainedProbe(models);
  } else {
    const usage = wantUsage ? await Promise.race([balanceP, delay(USAGE_WAIT_MS).then(() => null)]) : null;
    const listed = new Set(models.models);
    const used = (usage?.used_models ?? []).filter((m) => !listed.size || listed.has(m));
    const pricing = await pricingP;
    probe = await probeKey(base, apiKey, { models: models.models, ratios: pricing.ratios, preferred: [...pinned, ...used], hint: models.authHint, deadlineAt: deadline });
  }
  const [pricing, balance] = await Promise.all([pricingP, balanceP]);
  return finish(probe, models, pricing, balance, !useCache);
}

function drainedProbe(models: ModelsResult): ProbeOutcome {
  const msg = redact(models.authHint?.message ?? "余额不足");
  return {
    state: "no_quota",
    ok: false,
    rejected: false,
    error: msg,
    status: models.status,
    latency: null,
    summary: { model: null, endpoint: "/v1/models", attempts: [{ endpoint: "/v1/models", model: "-", status: models.status, outcome: "drained", ms: models.latency, note: msg.slice(0, 140) }] },
  };
}

function finish(probe: ProbeOutcome, models: ModelsResult, pricing: PricingResult, balance: BalanceResult, fresh: boolean): TestResult {
  // A failed probe on an account whose balance is spent is 无额度 — unless the
  // station explicitly rejected the key itself, which stays 不可用.
  let state = probe.state;
  let error = probe.error;
  const spent = balance.reachable && !balance.unlimited && balance.balance_usd != null && balance.balance_usd <= 0;
  if (spent && (state === "error" || (state === "dead" && !probe.rejected))) {
    state = "no_quota";
    error = `账户余额已用尽（$${balance.balance_usd!.toFixed(2)}）${probe.error ? `；${probe.error}` : ""}`;
  }
  return {
    state,
    alive: state === "ok" || state === "no_quota",
    latency_ms: probe.latency,
    http_status: probe.status || null,
    error,
    group_ratio: pricing.groupRatio,
    model_ratios: pricing.ratios,
    models: models.models,
    balance,
    balance_fresh: fresh,
    pricing_source: pricing.source,
    probe: probe.summary,
  };
}

export async function refreshBalance(site: SiteLike, apiKey: string): Promise<BalanceResult> {
  return fetchBalance(normalizeBase(site.base_url), apiKey, site);
}
