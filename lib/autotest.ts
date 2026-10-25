import type { Env } from "./types";

// Daily auto-测活: every key is tested at most once per China-day, driven by the
// dashboard that happens to be open. Pages Functions can't run a long
// background sweep (waitUntil is cut off ~30s after the response), so the page
// asks for today's pending keys and tests them one request per key. A per-key
// claim with a lease keeps two open devices from testing the same key twice; a
// lease that expires without a result (tab closed mid-test) is re-claimable.

const LEASE_SEC = 180;

// Unix seconds of today's 00:00 in China time (UTC+8).
export function chinaDayStart(nowMs = Date.now()): number {
  const shifted = Math.floor((nowMs + 8 * 3600 * 1000) / 86400000) * 86400000;
  return Math.floor((shifted - 8 * 3600 * 1000) / 1000);
}

// Keys with no verdict today that nobody is currently testing.
export async function pendingKeyIds(env: Env): Promise<number[]> {
  const now = Math.floor(Date.now() / 1000);
  const rows = await env.DB.prepare(
    `SELECT k.id FROM api_keys k
     LEFT JOIN key_status s ON s.key_id = k.id
     WHERE (s.tested_at IS NULL OR s.tested_at < ?1 OR (s.alive IS NULL AND s.state IS NULL))
       AND (k.auto_claimed_at IS NULL OR k.auto_claimed_at < ?2)
     ORDER BY k.id ASC`,
  )
    .bind(chinaDayStart(), now - LEASE_SEC)
    .all<{ id: number }>();
  return (rows.results ?? []).map((r) => r.id);
}

// Atomically claim one key for today's auto-test. Exactly one caller wins.
export async function claimKeyForAutoTest(env: Env, keyId: number): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const res = await env.DB.prepare(
    `UPDATE api_keys SET auto_claimed_at = ?2
     WHERE id = ?1
       AND (auto_claimed_at IS NULL OR auto_claimed_at < ?3)
       AND NOT EXISTS (
         SELECT 1 FROM key_status s
         WHERE s.key_id = api_keys.id AND s.tested_at >= ?4 AND (s.alive IS NOT NULL OR s.state IS NOT NULL)
       )`,
  )
    .bind(keyId, now, now - LEASE_SEC, chinaDayStart())
    .run();
  return (res.meta?.changes ?? 0) >= 1;
}
