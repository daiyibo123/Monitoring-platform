import { saveTestResult } from "../../../../lib/db";
import { fail, ok } from "../../../../lib/http";
import type { ApiKey, Env, Site } from "../../../../lib/types";
import { refreshBalance, testKey, type BalanceResult } from "../../../../lib/upstream";

// Test every key under a site concurrently, then persist each result.
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

  const results = await Promise.all(
    list.map(async (key) => {
      const result = await testKey(site.base_url, key.api_key, site.kind, key.group_name, site.access_token, {
        balance: siteBalance,
      });
      await saveTestResult(env, key.id, result);
      return { key_id: key.id, result };
    }),
  );

  return ok({ site_id: id, results });
};
