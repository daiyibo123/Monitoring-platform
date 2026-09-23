// Three-way key state, derived from liveness + account balance.
//   available — the key answers AND the account still has balance
//   no_quota  — the key itself works, but the account balance is used up (≤ 0)
//   dead      — the key is invalid / unreachable
//   untested  — never tested yet
//
// Balance is a site-level property (one site == one upstream account), so the
// balance passed here is the site's balance, shared by all its keys. A null
// balance means unknown or unlimited — never "no quota", so it stays available.
export type KeyState = "available" | "no_quota" | "dead" | "untested";

export function keyState(alive: number | null | undefined, accountBalance: number | null): KeyState {
  if (alive == null) return "untested";
  if (alive !== 1) return "dead";
  if (accountBalance != null && accountBalance <= 0) return "no_quota";
  return "available";
}

export const STATE_META: Record<KeyState, { label: string; dot: string; text: string; glow: boolean }> = {
  available: { label: "可用", dot: "bg-emerald-400", text: "text-emerald-400", glow: true },
  no_quota: { label: "无额度", dot: "bg-amber-400", text: "text-amber-400", glow: false },
  dead: { label: "不可用", dot: "bg-rose-400", text: "text-rose-400", glow: false },
  untested: { label: "未测活", dot: "bg-slate-500", text: "text-slate-500", glow: false },
};
