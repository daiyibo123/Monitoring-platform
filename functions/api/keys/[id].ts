import { fail, ok, readJson } from "../../../lib/http";
import type { Env } from "../../../lib/types";

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return fail("无效的 Key ID");

  const body = await readJson<{ label?: string; group_name?: string; api_key?: string }>(request);
  const label = (body.label || "").trim();
  const groupName = (body.group_name || "").trim();
  const apiKey = (body.api_key || "").trim();

  if (!apiKey) return fail("请填写 Key");

  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `UPDATE api_keys SET label=?2, group_name=?3, api_key=?4, updated_at=?5 WHERE id=?1`,
  )
    .bind(id, label, groupName, apiKey, now)
    .run();

  return ok({ id });
};

export const onRequestDelete: PagesFunction<Env> = async ({ env, params }) => {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return fail("无效的 Key ID");
  // Explicit cascade: D1 does not enforce FK ON DELETE by default.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM key_status WHERE key_id=?1").bind(id),
    env.DB.prepare("DELETE FROM api_keys WHERE id=?1").bind(id),
  ]);
  return ok({ id });
};
