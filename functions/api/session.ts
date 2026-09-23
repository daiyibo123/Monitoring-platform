import { buildSessionCookie, cookieDomain, createSessionToken, getSession, isSecureRequest } from "../../lib/auth";
import { json } from "../../lib/http";
import type { Env } from "../../lib/types";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const configured = Boolean(env.APP_PASSWORD && env.SESSION_SECRET);
  const session = configured ? await getSession(request, env) : null;

  // Sliding expiration: every session check re-issues the cookie with a fresh
  // 7-day window, so the "7 天免登录" clock counts from the user's last visit
  // rather than from login — an actively-used dashboard stays logged in
  // indefinitely, and only true 7-day inactivity signs them out. Preserves the
  // current edit flag so a refresh never silently drops edit mode.
  const headers: HeadersInit = {};
  if (session) {
    const token = await createSessionToken(session.edit, env);
    (headers as Record<string, string>)["Set-Cookie"] = buildSessionCookie(
      token,
      isSecureRequest(request),
      cookieDomain(env),
    );
  }

  // NOTE: this must return the same { success, data } envelope every other
  // endpoint uses, because the frontend api.request() unwraps `body.data`. If we
  // return a bare { authed, ... } object, api.session() resolves to `undefined`,
  // App.tsx's `const { authed } = await api.session()` throws on destructuring,
  // the catch drops the user to "guest" — and the dashboard bounces to login on
  // EVERY refresh, regardless of whether the session cookie is perfectly valid.
  return json(
    { success: true, data: { authed: session != null, configured, edit: session?.edit === true } },
    { headers },
  );
};
