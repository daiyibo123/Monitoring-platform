import { fail, ok, readJson } from "../../../lib/http";
import type { Env } from "../../../lib/types";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = await readJson<{
    site_id?: number;
    label?: string;
    group_name?: string;
    api_key?: string;
  }>(request);

  const siteId = Number(body.site_id);
  const label = (body.label || "").trim();
  const groupName = (body.group_name || "").trim();
  const apiKey = (body.api_key || "").trim();

  if (!Number.isFinite(siteId)) return fail("无效的网站 ID");
  if (!apiKey) return fail("请填写 Key");

  const site = await env.DB.prepare("SELECT id FROM sites WHERE id=?1").bind(siteId).first();
  if (!site) return fail("网站不存在", 404);

  const now = Math.floor(Date.now() / 1000);
  const res = await env.DB.prepare(
    `INSERT INTO api_keys (site_id, label, group_name, api_key, sort, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, 0, ?5, ?5)`,
  )
    .bind(siteId, label, groupName, apiKey, now)
    .run();

  return ok({ id: res.meta.last_row_id });
};
