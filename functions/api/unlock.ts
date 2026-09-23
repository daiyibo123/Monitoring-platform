import { buildSessionCookie, cookieDomain, createSessionToken, isSecureRequest, verifyPassword } from "../../lib/auth";
import { fail, readJson } from "../../lib/http";
import type { Env } from "../../lib/types";

// Upgrade an already-authenticated (read-only) session to edit mode by
// re-confirming the password. The middleware has already verified the session
// is valid; here we only check the password and re-sign the token with edit:true.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const { password } = await readJson<{ password?: string }>(request);
  if (!password) return fail("请输入密码", 400);

  if (!(await verifyPassword(password, env))) return fail("密码错误", 401);

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
