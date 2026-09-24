import { saveTestResult } from "../../../../lib/db";
import { fail, ok } from "../../../../lib/http";
import type { ApiKey, Env, Site } from "../../../../lib/types";
import { refreshBalance, testKey, type BalanceResult } from "../../../../lib/upstream";

// Test keys under a site with BOUNDED concurrency, then persist each result.
// Each testKey fires several subrequests (models + pricing + the real chat probe,
// which may itself retry), so an unbounded Promise.all over many keys opens a big
// simultaneous burst that trips Cloudflare's ~6-connection limit and makes good
// keys spuriously time out — the 全部测活 误判/超时 the operator hit. A small pool
// keeps concurrency sane while still finishing well inside the ~100s client
// window. (The once-daily auto sweep in lib/autotest.ts runs fully serial since
// nothing is waiting on it.)
const SITE_TEST_CONCURRENCY = 3;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      out[idx] = await fn(items[idx]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
export const onRequestPost: PagesFunction<Env> = async ({ env, params }) => {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return fail("无效的网站 ID");

  const site = await env.DB.prepare("SELECT * FROM sites WHERE id=?1").bind(id).first<Site>();
  if (!site) return fail("网站不存在", 404);

  const keys = await env.DB.prepare("SELECT * FROM api_keys WHERE site_id=?1").bind(id).all<ApiKey>();
  const list = keys.results ?? [];

  // Balance is account-level (one site = one upstream account), so fetch it ONCE
  // and reuse it for every key rather than re-hitting the billing endpoint per
  // key. Each key's test otherwise fires models + pricing + a real chat probe;
  // dropping the redundant per-key balance call keeps the whole invocation well
  // under Cloudflare's per-request subrequest limit — overshooting it was what
  // turned 全部测活 into gateway/timeout (HTML) errors. We try keys in order only
  // until one returns an authoritative reading (capped so an all-dead site can't
  // serialise a long balance sweep); if none do, testKey falls back to fetching
  // balance itself per key.
  let siteBalance: BalanceResult | null = null;
  for (const key of list.slice(0, 3)) {
    const bal = await refreshBalance(site.base_url, key.api_key, site.kind, site.access_token);
    if (bal.reachable) {
      siteBalance = bal;
      break;
    }
  }

  const results = await mapLimit(list, SITE_TEST_CONCURRENCY, async (key) => {
    const result = await testKey(site.base_url, key.api_key, site.kind, key.group_name, site.access_token, {
      balance: siteBalance,
    });
    await saveTestResult(env, key.id, result);
    return { key_id: key.id, result };
  });

  return ok({ site_id: id, results });
};
