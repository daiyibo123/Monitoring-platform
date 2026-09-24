import { claimDailyAutoTest, runDailyAutoTest } from "../../../lib/autotest";
import { loadSitesWithKeys } from "../../../lib/db";
import { fail, ok, readJson } from "../../../lib/http";
import type { Env, SiteKind } from "../../../lib/types";

const KINDS: SiteKind[] = ["newapi", "sub2api", "openai"];

export const onRequestGet: PagesFunction<Env> = async ({ env, waitUntil }) => {
  const sites = await loadSitesWithKeys(env);

  // Daily auto-测活: the FIRST dashboard open of each (China) day kicks off ONE
  // full liveness sweep; every other open that day is a no-op. The frontend
  // can't be rebuilt here, so we hook the endpoint it ALREADY calls on entry
  // (GET /api/sites) instead of adding a client trigger. The sweep runs via
  // waitUntil so the page load never waits on it — fresh statuses land in the DB
  // and show on the next load/refresh. Manual 测活 buttons are unaffected, and
  // the sweep uses the same minimum-token probe (~2 tokens per working key).
  if (await claimDailyAutoTest(env)) {
    waitUntil(runDailyAutoTest(env));
  }

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
