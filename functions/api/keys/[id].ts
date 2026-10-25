import { fail, ok, readJson } from "../../../lib/http";
import type { ApiKey, Env } from "../../../lib/types";

// api_key: omitted or blank = keep the stored key (the list never sends it).
export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return fail("无效的 Key ID");

  const body = await readJson<{ label?: string; group_name?: string; api_key?: string }>(request);
  const label = (body.label || "").trim();
  const groupName = (body.group_name || "").trim();
  const newKey = (body.api_key || "").trim();

  const key = await env.DB.prepare("SELECT * FROM api_keys WHERE id=?1").bind(id).first<ApiKey>();
  if (!key) return fail("Key 不存在", 404);

  const apiKey = newKey || key.api_key;
  const now = Math.floor(Date.now() / 1000);
  const stmts = [
    env.DB.prepare(`UPDATE api_keys SET label=?2, group_name=?3, api_key=?4, updated_at=?5 WHERE id=?1`).bind(id, label, groupName, apiKey, now),
  ];
  // The old verdict described a different key / group.
  if (apiKey !== key.api_key || groupName !== key.group_name) {
    stmts.push(
      env.DB.prepare("DELETE FROM key_status WHERE key_id=?1").bind(id),
      env.DB.prepare("UPDATE api_keys SET auto_claimed_at=NULL WHERE id=?1").bind(id),
    );
  }
  await env.DB.batch(stmts);

  return ok({ id, key_changed: apiKey !== key.api_key });
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
