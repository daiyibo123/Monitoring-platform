import type { Site } from "../types";

// Balance is a site-level property: one site == one upstream account, and its
// multiple keys just expose different models/channels of that same account.
// So a site has ONE balance — the first non-null value among its keys (taking
// non-null skips a key whose balance fetch happened to fail, showing too low).
export function siteBalance(site: Site): number | null {
  for (const k of site.keys) {
    if (k.status?.balance_usd != null) return k.status.balance_usd;
  }
  return null;
}
