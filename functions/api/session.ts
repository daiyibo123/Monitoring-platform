import { getSession } from "../../lib/auth";
import { json } from "../../lib/http";
import type { Env } from "../../lib/types";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const configured = Boolean(env.APP_PASSWORD && env.SESSION_SECRET);
  const session = configured ? await getSession(request, env) : null;
  return json({ authed: session != null, configured, edit: session?.edit === true });
};
