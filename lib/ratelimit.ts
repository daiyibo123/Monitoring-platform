import type { Env } from "./types";

// Brute-force guard for the password endpoints: per client IP, at most
// MAX_FAILURES wrong passwords per WINDOW_SEC. A success clears the counter.

const WINDOW_SEC = 15 * 60;
const MAX_FAILURES = 8;

function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For")?.split(",")[0].trim() || "local";
}

export function failureBucket(scope: "login" | "unlock", request: Request): string {
  return `${scope}:${clientIp(request)}`;
}

// Seconds until the bucket may try again, or 0 when not limited.
export async function retryAfter(env: Env, bucket: string): Promise<number> {
  const row = await env.DB.prepare("SELECT count, window_start FROM auth_failures WHERE bucket=?1")
    .bind(bucket)
    .first<{ count: number; window_start: number }>();
  if (!row) return 0;
  const now = Math.floor(Date.now() / 1000);
  if (now - row.window_start >= WINDOW_SEC || row.count < MAX_FAILURES) return 0;
  return row.window_start + WINDOW_SEC - now;
}

export async function recordFailure(env: Env, bucket: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO auth_failures (bucket, count, window_start) VALUES (?1, 1, ?2)
     ON CONFLICT(bucket) DO UPDATE SET
       count = CASE WHEN ?2 - window_start >= ?3 THEN 1 ELSE count + 1 END,
       window_start = CASE WHEN ?2 - window_start >= ?3 THEN ?2 ELSE window_start END`,
  )
    .bind(bucket, now, WINDOW_SEC)
    .run();
}

export async function clearFailures(env: Env, bucket: string): Promise<void> {
  const cutoff = Math.floor(Date.now() / 1000) - WINDOW_SEC;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_failures WHERE bucket=?1").bind(bucket),
    env.DB.prepare("DELETE FROM auth_failures WHERE window_start < ?1").bind(cutoff),
  ]);
}

export function rateLimitedMessage(seconds: number): string {
  return `密码错误次数过多，请 ${Math.max(1, Math.ceil(seconds / 60))} 分钟后再试`;
}
