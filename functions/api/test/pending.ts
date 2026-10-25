import { chinaDayStart, pendingKeyIds } from "../../../lib/autotest";
import { ok } from "../../../lib/http";
import type { Env } from "../../../lib/types";

// Keys still waiting for today's auto-test (see lib/autotest.ts).
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  return ok({ key_ids: await pendingKeyIds(env), day_start: chinaDayStart() });
};
