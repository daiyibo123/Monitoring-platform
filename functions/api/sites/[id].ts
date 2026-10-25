import { fail, ok, readJson } from "../../../lib/http";
import type { Env, Site, SiteKind } from "../../../lib/types";

const KINDS: SiteKind[] = ["newapi", "sub2api", "openai"];

// access_token: omitted = keep the stored token, a string = replace it,
// clear_access_token: true = remove it. The token itself is never sent back.
export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return fail("无效的网站 ID");

  const body = await readJson<{
    name?: string;
    base_url?: string;
    kind?: string;
    note?: string;
    access_token?: string;
    clear_access_token?: boolean;
    newapi_user_id?: string;
  }>(request);
  const name = (body.name || "").trim();
  const baseUrl = (body.base_url || "").trim();
  const kind = (KINDS.includes(body.kind as SiteKind) ? body.kind : "newapi") as SiteKind;
  const note = (body.note || "").trim();
  const userId = (body.newapi_user_id || "").trim();

  if (!name) return fail("请填写网站名称");
  if (!/^https?:\/\/[^\s/]+/i.test(baseUrl)) return fail("网站地址需以 http:// 或 https:// 开头");
  if (userId && !/^\d{1,12}$/.test(userId)) return fail("用户 ID 只能是数字");

  const site = await env.DB.prepare("SELECT * FROM sites WHERE id=?1").bind(id).first<Site>();
  if (!site) return fail("网站不存在", 404);

  let accessToken = site.access_token;
  if (body.clear_access_token) accessToken = "";
  else if (typeof body.access_token === "string" && body.access_token.trim()) accessToken = body.access_token.trim();

  const now = Math.floor(Date.now() / 1000);
  const stmts = [
    env.DB.prepare(
      `UPDATE sites SET name=?2, base_url=?3, kind=?4, note=?5, access_token=?6, newapi_user_id=?7, updated_at=?8 WHERE id=?1`,
    ).bind(id, name, baseUrl, kind, note, accessToken, userId, now),
  ];
  // Results measured against the old endpoint/type no longer describe this site.
  if (site.base_url !== baseUrl || site.kind !== kind) {
    stmts.push(
      env.DB.prepare("DELETE FROM key_status WHERE key_id IN (SELECT id FROM api_keys WHERE site_id=?1)").bind(id),
      env.DB.prepare("DELETE FROM site_status WHERE site_id=?1").bind(id),
      env.DB.prepare("UPDATE api_keys SET auto_claimed_at=NULL WHERE site_id=?1").bind(id),
    );
  } else if (accessToken !== site.access_token || userId !== (site.newapi_user_id ?? "")) {
    stmts.push(env.DB.prepare("DELETE FROM site_status WHERE site_id=?1").bind(id));
  }
  await env.DB.batch(stmts);

  return ok({ id });
};

export const onRequestDelete: PagesFunction<Env> = async ({ env, params }) => {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return fail("无效的网站 ID");
  // Explicit cascade: D1 does not enforce FK ON DELETE by default.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM key_status WHERE key_id IN (SELECT id FROM api_keys WHERE site_id=?1)").bind(id),
    env.DB.prepare("DELETE FROM api_keys WHERE site_id=?1").bind(id),
    env.DB.prepare("DELETE FROM site_status WHERE site_id=?1").bind(id),
    env.DB.prepare("DELETE FROM sites WHERE id=?1").bind(id),
  ]);
  return ok({ id });
};
