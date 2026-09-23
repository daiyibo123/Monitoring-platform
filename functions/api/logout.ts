import { buildClearCookie, cookieDomain, isSecureRequest } from "../../lib/auth";
import type { Env } from "../../lib/types";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const cookie = buildClearCookie(isSecureRequest(request), cookieDomain(env));
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": cookie,
      "Cache-Control": "no-store",
    },
  });
};
