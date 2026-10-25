import { api } from "../api";

// Full keys are never in the site list; they are fetched on demand (copy /
// reveal) and kept in memory for this tab only. Cleared on logout.
const cache = new Map<number, Promise<string>>();

export function getKeySecret(id: number): Promise<string> {
  let p = cache.get(id);
  if (!p) {
    p = api.keySecret(id).then((r) => r.api_key);
    p.catch(() => cache.delete(id));
    cache.set(id, p);
  }
  return p;
}

export function forgetKeySecret(id: number): void {
  cache.delete(id);
}

export function clearKeySecrets(): void {
  cache.clear();
}
