import { buildSessionCookie, createSessionToken, isSecureRequest, verifyCredentials } from "../../lib/auth";
import { fail, readJson } from "../../lib/http";
import type { Env } from "../../lib/types";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.APP_PASSWORD || !env.SESSION_SECRET) {
    return fail("服务器未配置 APP_PASSWORD / SESSION_SECRET", 500);
  }
  const { username, password } = await readJson<{ username?: string; password?: string }>(request);
  if (!password) return fail("请输入密码", 400);

  // Username defaults to "admin" so the historic password-only habit still works.
  const ok = await verifyCredentials({ username: (username || "admin").trim(), password }, env);
  if (!ok) return fail("用户名或密码错误", 401);

  // Login lands in read-only mode; editing requires unlocking with the password.
  const token = await createSessionToken(false, env);
  const cookie = buildSessionCookie(token, isSecureRequest(request));
  return new Response(JSON.stringify({ success: true, data: { ok: true } }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": cookie,
      "Cache-Control": "no-store",
    },
  });
};
