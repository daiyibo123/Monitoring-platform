import { buildClearCookie, isSecureRequest } from "../../lib/auth";
import type { Env } from "../../lib/types";

export const onRequestPost: PagesFunction<Env> = async ({ request }) => {
  const cookie = buildClearCookie(isSecureRequest(request));
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": cookie,
      "Cache-Control": "no-store",
    },
  });
};
