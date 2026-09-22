import { saveTestResult } from "../../../../lib/db";
import { fail, ok } from "../../../../lib/http";
import type { ApiKey, Env, Site } from "../../../../lib/types";
import { testKey } from "../../../../lib/upstream";

// Test a single key: liveness + models + multipliers + balance, then persist.
export const onRequestPost: PagesFunction<Env> = async ({ env, params }) => {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return fail("无效的 Key ID");

  const key = await env.DB.prepare("SELECT * FROM api_keys WHERE id=?1").bind(id).first<ApiKey>();
  if (!key) return fail("Key 不存在", 404);

  const site = await env.DB.prepare("SELECT * FROM sites WHERE id=?1").bind(key.site_id).first<Site>();
  if (!site) return fail("网站不存在", 404);

  const result = await testKey(site.base_url, key.api_key, site.kind, key.group_name, site.access_token);
  await saveTestResult(env, id, result);

  return ok({ key_id: id, result });
};
