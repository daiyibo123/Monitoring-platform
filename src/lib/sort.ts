import type { ApiKey, Site } from "../types";
import { siteBalance } from "./balance";
import { keyState } from "./status";

// One overall order, two levels: 可用 first, then 不可用; inside each tier,
// higher balance first (unknown balance last). Ties keep the server order.

export function siteAvailable(site: Site): boolean {
  const bal = siteBalance(site);
  return site.keys.some((k) => keyState(k.status, bal) === "available");
}

const byBalanceDesc = (a: number | null, b: number | null) => {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return b - a;
};

export function sortSites(sites: Site[]): Site[] {
  return sites
    .map((site, i) => ({ site, i, up: siteAvailable(site) ? 0 : 1, bal: siteBalance(site) }))
    .sort((a, b) => a.up - b.up || byBalanceDesc(a.bal, b.bal) || a.i - b.i)
    .map((x) => x.site);
}

// Keys of one site share its balance, so inside each tier they go by group
// ratio, cheapest first (unknown ratio last).
export function sortKeys(site: Site): ApiKey[] {
  const bal = siteBalance(site);
  return site.keys
    .map((k, i) => ({ k, i, up: keyState(k.status, bal) === "available" ? 0 : 1, r: k.status?.group_ratio ?? null }))
    .sort((a, b) => {
      if (a.up !== b.up) return a.up - b.up;
      if (a.r == null && b.r != null) return 1;
      if (a.r != null && b.r == null) return -1;
      if (a.r != null && b.r != null && a.r !== b.r) return a.r - b.r;
      return a.i - b.i;
    })
    .map((x) => x.k);
}
