import { saveBalance } from "../../../lib/db";
import { ok, readJson } from "../../../lib/http";
import type { ApiKey, Env, Site } from "../../../lib/types";
import { refreshBalance } from "../../../lib/upstream";

// Refresh balances only (fast). Called automatically on login and on demand.
// Optional body { site_id } narrows to one site; otherwise all keys.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = await readJson<{ site_id?: number }>(request);
  const siteId = Number(body.site_id);

  const sitesRes = await env.DB.prepare("SELECT * FROM sites").all<Site>();
  const siteMap = new Map<number, Site>();
  for (const s of sitesRes.results ?? []) siteMap.set(s.id, s);

  const keysRes = Number.isFinite(siteId)
    ? await env.DB.prepare("SELECT * FROM api_keys WHERE site_id=?1").bind(siteId).all<ApiKey>()
    : await env.DB.prepare("SELECT * FROM api_keys").all<ApiKey>();

  const keys = keysRes.results ?? [];

  const results = await Promise.all(
    keys.map(async (key) => {
      const site = siteMap.get(key.site_id);
      if (!site) return { key_id: key.id, balance_usd: null, total_usage_usd: null };
      const bal = await refreshBalance(site.base_url, key.api_key, site.kind);
      await saveBalance(env, key.id, bal.balance_usd, bal.total_usage_usd, bal.raw);
      return { key_id: key.id, balance_usd: bal.balance_usd, total_usage_usd: bal.total_usage_usd };
    }),
  );

  return ok({ results });
};
