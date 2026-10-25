import type { Site } from "../types";

// Balance is site-level: one site == one upstream account; its keys expose
// different groups/models of that same account. null = unknown or unlimited.
export function siteBalance(site: Site): number | null {
  if (site.balance) {
    if (site.balance.usd != null) return site.balance.usd;
    if (site.balance.unlimited) return null;
  }
  // Fallback for data from before site-level balances: first per-key reading.
  for (const k of site.keys) {
    if (k.status?.balance_usd != null) return k.status.balance_usd;
  }
  return null;
}
