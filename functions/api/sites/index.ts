import { loadSitesWithKeys } from "../../../lib/db";
import { fail, ok, readJson } from "../../../lib/http";
import type { Env, SiteKind } from "../../../lib/types";

const KINDS: SiteKind[] = ["newapi", "sub2api", "openai"];

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const sites = await loadSitesWithKeys(env);
  return ok(sites);
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = await readJson<{ name?: string; base_url?: string; kind?: string; note?: string; access_token?: string }>(request);
  const name = (body.name || "").trim();
  const baseUrl = (body.base_url || "").trim();
  const kind = (KINDS.includes(body.kind as SiteKind) ? body.kind : "newapi") as SiteKind;
  const note = (body.note || "").trim();
  const accessToken = (body.access_token || "").trim();

  if (!name) return fail("请填写网站名称");
  if (!/^https?:\/\//i.test(baseUrl)) return fail("网站地址需以 http:// 或 https:// 开头");

  const now = Math.floor(Date.now() / 1000);
  const res = await env.DB.prepare(
    `INSERT INTO sites (name, base_url, kind, note, access_token, sort, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?6)`,
  )
    .bind(name, baseUrl, kind, note, accessToken, now)
    .run();

  return ok({ id: res.meta.last_row_id });
};
