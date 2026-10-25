import { buildSessionCookie, cookieDomain, createSessionToken, isSecureRequest, verifyPassword } from "../../lib/auth";
import { fail, readJson } from "../../lib/http";
import { clearFailures, failureBucket, rateLimitedMessage, recordFailure, retryAfter } from "../../lib/ratelimit";
import type { Env } from "../../lib/types";

// Upgrade an already-authenticated (read-only) session to edit mode by
// re-confirming the password. The middleware has already verified the session
// is valid; here we only check the password and re-sign the token with edit:true.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const bucket = failureBucket("unlock", request);
  const wait = await retryAfter(env, bucket);
  if (wait > 0) return fail(rateLimitedMessage(wait), 429);

  const { password } = await readJson<{ password?: string }>(request);
  if (!password) return fail("请输入密码", 400);

  // 403, not 401: the session itself is fine, and the client treats 401 as "logged out".
  if (!(await verifyPassword(password, env))) {
    await recordFailure(env, bucket);
    return fail("密码错误", 403);
  }
  await clearFailures(env, bucket);

  const token = await createSessionToken(true, env);
  const cookie = buildSessionCookie(token, isSecureRequest(request), cookieDomain(env));
  return new Response(JSON.stringify({ success: true, data: { edit: true } }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": cookie,
      "Cache-Control": "no-store",
    },
  });
};
