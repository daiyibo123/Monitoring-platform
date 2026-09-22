import { saveTestResult } from "../../../../lib/db";
import { fail, ok } from "../../../../lib/http";
import type { ApiKey, Env, Site } from "../../../../lib/types";
import { testKey } from "../../../../lib/upstream";

// Test every key under a site concurrently, then persist each result.
export const onRequestPost: PagesFunction<Env> = async ({ env, params }) => {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return fail("无效的网站 ID");

  const site = await env.DB.prepare("SELECT * FROM sites WHERE id=?1").bind(id).first<Site>();
  if (!site) return fail("网站不存在", 404);

  const keys = await env.DB.prepare("SELECT * FROM api_keys WHERE site_id=?1").bind(id).all<ApiKey>();
  const list = keys.results ?? [];

  const results = await Promise.all(
    list.map(async (key) => {
      const result = await testKey(site.base_url, key.api_key, site.kind, key.group_name);
      await saveTestResult(env, key.id, result);
      return { key_id: key.id, result };
    }),
  );

  return ok({ site_id: id, results });
};
