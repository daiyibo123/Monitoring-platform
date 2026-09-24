import { saveTestResult } from "./db";
import type { ApiKey, Env, Site } from "./types";
import { refreshBalance, testKey, type BalanceResult } from "./upstream";

const AUTOTEST_KEY = "auto_test_date";

// Today's date (YYYY-MM-DD) in China time (UTC+8). The "one sweep per day"
// boundary follows the operator's local day; keying on UTC would roll the day
// over at 08:00 local, which is not what "每天一次" means to them.
function chinaDate(): string {
  const utc8 = new Date(Date.now() + 8 * 3600 * 1000);
  return utc8.toISOString().slice(0, 10);
}

// Atomically claim today's single auto-测活 slot. Returns true for EXACTLY ONE
// caller per China-day; every other dashboard open that day (any user/device)
// gets false. Implemented as a conditional upsert so two simultaneous first-
// opens can't both win: SQLite is single-writer, and meta.changes is 1 only when
// the row was actually inserted (first ever) or moved to a new day — a same-day
// open hits the `WHERE value <> today` guard and writes nothing (changes = 0).
export async function claimDailyAutoTest(env: Env): Promise<boolean> {
  const today = chinaDate();
  const res = await env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES (?1, ?2)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value
       WHERE settings.value <> excluded.value`,
  )
    .bind(AUTOTEST_KEY, today)
    .run();
  return (res.meta?.changes ?? 0) >= 1;
}

// One full liveness sweep across every site's every key. Because it runs in the
// background (waitUntil) with no client waiting on it, it goes FULLY SERIAL —
// one key at a time, sites in order. Each testKey still fires only its own ~3
// internal subrequests, so at most ~3 connections are ever open at once: no
// burst, which is exactly what removes the spurious 超时/直接不可用 a parallel
// sweep caused. Balance is account-level so it's fetched ONCE per site and
// reused. Same minimum-token probe as manual 测活 (max_tokens:1 — only a genuine
// success spends ~2 tokens, failures spend 0). Each key's status is persisted
// the instant it finishes, so a not-yet-reached key keeps showing yesterday's
// state until the sweep gets to it.
export async function runDailyAutoTest(env: Env): Promise<void> {
  const sites = (await env.DB.prepare("SELECT * FROM sites ORDER BY id ASC").all<Site>()).results ?? [];
  for (const site of sites) {
    const keys =
      (await env.DB.prepare("SELECT * FROM api_keys WHERE site_id=?1 ORDER BY id ASC").bind(site.id).all<ApiKey>())
        .results ?? [];
    if (!keys.length) continue;

    // Fetch the account balance once (try up to 3 keys until one reading is
    // authoritative), then reuse it for every key of this site.
    let siteBalance: BalanceResult | null = null;
    for (const key of keys.slice(0, 3)) {
      const bal = await refreshBalance(site.base_url, key.api_key, site.kind, site.access_token);
      if (bal.reachable) {
        siteBalance = bal;
        break;
      }
    }

    // Serial per key — test, persist, then move to the next.
    for (const key of keys) {
      try {
        const result = await testKey(site.base_url, key.api_key, site.kind, key.group_name, site.access_token, {
          balance: siteBalance,
        });
        await saveTestResult(env, key.id, result);
      } catch {
        // One key's failure must never abort the rest of the daily sweep.
      }
    }
  }
}
