import { loadSiteBalance, saveSiteBalance } from "../../../lib/db";
import { fail, ok, readJson } from "../../../lib/http";
import type { ApiKey, BalanceResult, Env, Site, SiteStatusRow } from "../../../lib/types";
import { refreshBalance } from "../../../lib/upstream";

// Without force, a balance refreshed this recently is returned as-is.
const MIN_REFRESH_SEC = 60;

// Refresh ONE site's account balance (the dashboard calls this per site with
// bounded concurrency). Balance is account-level, so it is read once per site:
// keys are tried in order until one gives a reading. A failed refresh keeps the
// last known balance and only records the error.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { site_id, force } = await readJson<{ site_id?: number; force?: boolean }>(request);
  const siteId = Number(site_id);
  if (!Number.isFinite(siteId)) return fail("缺少 site_id");

  const site = await env.DB.prepare("SELECT * FROM sites WHERE id=?1").bind(siteId).first<Site>();
  if (!site) return fail("网站不存在", 404);

  if (!force) {
    const row = await env.DB.prepare("SELECT checked_at FROM site_status WHERE site_id=?1").bind(siteId).first<Pick<SiteStatusRow, "checked_at">>();
    if (row?.checked_at && Math.floor(Date.now() / 1000) - row.checked_at < MIN_REFRESH_SEC) {
      return ok({ site_id: siteId, balance: await loadSiteBalance(env, siteId), cached: true });
    }
  }

  const keys = (await env.DB.prepare("SELECT * FROM api_keys WHERE site_id=?1 ORDER BY id ASC LIMIT 3").bind(siteId).all<ApiKey>()).results ?? [];
  if (!keys.length) return ok({ site_id: siteId, balance: await loadSiteBalance(env, siteId), cached: false });

  // With an access token the reading is per account, not per key: one try is enough.
  const tries = site.kind === "newapi" && site.access_token ? keys.slice(0, 1) : keys;
  let best: BalanceResult | null = null;
  for (const key of tries) {
    const b = await refreshBalance(site, key.api_key);
    if (!best || (b.reachable && !best.reachable) || (b.balance_usd != null && best.balance_usd == null)) best = b;
    if (b.balance_usd != null) break;
  }
  if (best) await saveSiteBalance(env, siteId, best);

  return ok({ site_id: siteId, balance: await loadSiteBalance(env, siteId), cached: false });
};
