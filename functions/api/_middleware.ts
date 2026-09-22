import { getSession } from "../../lib/auth";
import { forbidden, unauthorized } from "../../lib/http";
import { ensureSchema } from "../../lib/schema";
import type { Env } from "../../lib/types";

// Guards every /api/* route except the public auth endpoints.
const PUBLIC_PATHS = new Set(["/api/login", "/api/session"]);

// Write operations on these prefixes require an unlocked (edit) session. A plain
// logged-in session may still GET them, run tests (/api/test/*), refresh
// balances (/api/balance/*) and unlock/lock its own edit mode.
const ADMIN_WRITE_PREFIXES = ["/api/sites", "/api/keys"];

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, next } = context;
  const url = new URL(request.url);

  if (PUBLIC_PATHS.has(url.pathname)) {
    return next();
  }

  if (!env.SESSION_SECRET || !env.APP_PASSWORD) {
    return unauthorized();
  }

  const session = await getSession(request, env);
  if (!session) return unauthorized();

  // Read-only sessions cannot mutate site/key CRUD; they must unlock edit mode.
  const isWrite = request.method !== "GET" && request.method !== "HEAD";
  const hitsAdminPrefix = ADMIN_WRITE_PREFIXES.some((p) => url.pathname.startsWith(p));
  if (isWrite && hitsAdminPrefix && !session.edit) {
    return forbidden();
  }

  // Self-provision tables on first authed request per isolate.
  await ensureSchema(env);

  return next();
};
