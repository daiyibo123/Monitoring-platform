import { getSession } from "../../lib/auth";
import { fail, forbidden, unauthorized } from "../../lib/http";
import { ensureSchema } from "../../lib/schema";
import type { Env } from "../../lib/types";

// Guards every /api/* route except the public auth endpoints.
const PUBLIC_PATHS = new Set(["/api/login", "/api/session"]);

// Write operations on these prefixes require an unlocked (edit) session. A plain
// logged-in session may still GET them (including a key's secret for copying),
// run tests (/api/test/*), refresh balances (/api/balance/*) and lock/unlock.
const ADMIN_WRITE_PREFIXES = ["/api/sites", "/api/keys"];

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const configured = Boolean(env.SESSION_SECRET && env.APP_PASSWORD);

  // Self-provision tables once per isolate (the login rate limiter needs them too).
  if (configured && env.DB) {
    try {
      await ensureSchema(env);
    } catch (e: any) {
      return fail(`数据库初始化失败：${e?.message || e}`, 500);
    }
  }

  if (PUBLIC_PATHS.has(url.pathname)) return next();
  if (!configured) return unauthorized();

  const session = await getSession(request, env);
  if (!session) return unauthorized();

  const isWrite = request.method !== "GET" && request.method !== "HEAD";
  const hitsAdminPrefix = ADMIN_WRITE_PREFIXES.some((p) => url.pathname.startsWith(p));
  if (isWrite && hitsAdminPrefix && !session.edit) return forbidden();

  return next();
};
