import { fail, ok, readJson } from "../../../lib/http";
import type { Env, SiteKind } from "../../../lib/types";

const KINDS: SiteKind[] = ["newapi", "sub2api", "openai"];

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return fail("无效的网站 ID");

  const body = await readJson<{ name?: string; base_url?: string; kind?: string; note?: string }>(request);
  const name = (body.name || "").trim();
  const baseUrl = (body.base_url || "").trim();
  const kind = (KINDS.includes(body.kind as SiteKind) ? body.kind : "newapi") as SiteKind;
  const note = (body.note || "").trim();

  if (!name) return fail("请填写网站名称");
  if (!/^https?:\/\//i.test(baseUrl)) return fail("网站地址需以 http:// 或 https:// 开头");

  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `UPDATE sites SET name=?2, base_url=?3, kind=?4, note=?5, updated_at=?6 WHERE id=?1`,
  )
    .bind(id, name, baseUrl, kind, note, now)
    .run();

  return ok({ id });
};

export const onRequestDelete: PagesFunction<Env> = async ({ env, params }) => {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return fail("无效的网站 ID");
  // Explicit cascade: D1 does not enforce FK ON DELETE by default.
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM key_status WHERE key_id IN (SELECT id FROM api_keys WHERE site_id=?1)",
    ).bind(id),
    env.DB.prepare("DELETE FROM api_keys WHERE site_id=?1").bind(id),
    env.DB.prepare("DELETE FROM sites WHERE id=?1").bind(id),
  ]);
  return ok({ id });
};
