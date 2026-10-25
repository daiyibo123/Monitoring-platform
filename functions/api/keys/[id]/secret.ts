import { fail, ok } from "../../../../lib/http";
import type { Env } from "../../../../lib/types";

// The full key, fetched on demand for copy/reveal. Lists only carry a masked form.
export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return fail("无效的 Key ID");
  const row = await env.DB.prepare("SELECT api_key FROM api_keys WHERE id=?1").bind(id).first<{ api_key: string }>();
  if (!row) return fail("Key 不存在", 404);
  return ok({ api_key: row.api_key });
};
