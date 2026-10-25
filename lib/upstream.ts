import { fetchBalance } from "./balance";
import { fetchModels, fetchPricing } from "./models";
import { normalizeBase, redact } from "./net";
import { probeKey, type ProbeOutcome } from "./probe";
import type { BalanceResult, Site, TestResult } from "./types";

// One key test: models + pricing + (cached or fresh) balance, then the real-
// request probe decides the verdict. Runs server-side inside Pages Functions,
// so it is not subject to browser CORS and keys never reach the client.

type SiteLike = Pick<Site, "base_url" | "kind" | "access_token" | "newapi_user_id">;

// Hard cap for one whole key test, so a dashboard request always returns.
const TEST_DEADLINE_MS = 55000;

export async function testKey(site: SiteLike, apiKey: string, groupName: string, cachedBalance: BalanceResult | null = null): Promise<TestResult> {
  const deadline = Date.now() + TEST_DEADLINE_MS;
  const base = normalizeBase(site.base_url);
  const balanceP = cachedBalance ? Promise.resolve(cachedBalance) : fetchBalance(base, apiKey, site);
  const [models, pricing] = await Promise.all([
    fetchModels(base, apiKey),
    fetchPricing(base, apiKey, site.kind, groupName, site.access_token, site.newapi_user_id),
  ]);

  let probe: ProbeOutcome;
  if (models.authHint?.outcome === "drained") {
    // /v1/models passes the same auth + billing gate as a completion, so a clear
    // "out of balance" there is final and saves the probe calls.
    const note = redact(models.authHint.message).slice(0, 140);
    probe = {
      state: "no_quota",
      ok: false,
      rejected: false,
      error: redact(models.authHint.message),
      status: models.status,
      latency: null,
      summary: { model: null, endpoint: "/v1/models", attempts: [{ endpoint: "/v1/models", model: "-", status: models.status, outcome: "drained", ms: models.latency, note }] },
    };
  } else {
    probe = await probeKey(base, apiKey, models.models, pricing.ratios, models.authHint, deadline);
  }
  const balance = await balanceP;

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
    balance_fresh: !cachedBalance,
    pricing_source: pricing.source,
    probe: probe.summary,
  };
}

export async function refreshBalance(site: SiteLike, apiKey: string): Promise<BalanceResult> {
  return fetchBalance(normalizeBase(site.base_url), apiKey, site);
}
