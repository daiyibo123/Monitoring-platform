import { claimKeyForAutoTest } from "../../../../lib/autotest";
import { cachedSiteBalance, loadSiteBalance, saveSiteBalance, saveTestResult } from "../../../../lib/db";
import { fail, ok, readJson } from "../../../../lib/http";
import type { ApiKey, Env, KeyStatusRow, ProbeSummary, Site } from "../../../../lib/types";
import { testKey } from "../../../../lib/upstream";

// A site balance read this recently is reused instead of re-fetched per key.
const BALANCE_CACHE_SEC = 300;

// Test one key (one request per key keeps every invocation far inside the
// Cloudflare subrequest/connection limits). Body { auto: true } = daily
// auto-test: the key is claimed atomically first and skipped if already done.
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return fail("无效的 Key ID");
  const { auto } = await readJson<{ auto?: boolean }>(request);

  const key = await env.DB.prepare("SELECT * FROM api_keys WHERE id=?1").bind(id).first<ApiKey>();
  if (!key) return fail("Key 不存在", 404);
  const site = await env.DB.prepare("SELECT * FROM sites WHERE id=?1").bind(key.site_id).first<Site>();
  if (!site) return fail("网站不存在", 404);

  if (auto === true && !(await claimKeyForAutoTest(env, id))) {
    return ok({ key_id: id, skipped: true });
  }

  // The model that passed last time is tried first again.
  const prev = await env.DB.prepare("SELECT state, probe FROM key_status WHERE key_id=?1").bind(id).first<Pick<KeyStatusRow, "state" | "probe">>();
  let lastOk: string | undefined;
  if (prev?.state === "ok" && prev.probe) {
    try {
      lastOk = (JSON.parse(prev.probe) as ProbeSummary).model ?? undefined;
    } catch {
      lastOk = undefined;
    }
  }

  const cached = await cachedSiteBalance(env, site.id, BALANCE_CACHE_SEC);
  const result = await testKey(site, key.api_key, key.group_name, cached, { pinned: key.probe_model || undefined, lastOk });
  const status = await saveTestResult(env, id, result);
  // The site balance is set by the first good reading in each cache window, so
  // keys of one site reading slightly different numbers can't make it flip.
  const b = result.balance;
  if (!cached && result.balance_fresh && b.reachable && (b.balance_usd != null || b.unlimited)) {
    await saveSiteBalance(env, site.id, b);
  }

  return ok({ key_id: id, site_id: site.id, skipped: false, status, balance: await loadSiteBalance(env, site.id) });
};
