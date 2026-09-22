import { buildSessionCookie, createSessionToken, isSecureRequest } from "../../lib/auth";
import type { Env } from "../../lib/types";

// Exit edit mode: re-sign the session token back to read-only (edit:false).
// The middleware guarantees the session is already valid.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const token = await createSessionToken(false, env);
  const cookie = buildSessionCookie(token, isSecureRequest(request));
  return new Response(JSON.stringify({ success: true, data: { edit: false } }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": cookie,
      "Cache-Control": "no-store",
    },
  });
};
