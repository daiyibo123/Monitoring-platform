import type { KeyStatus } from "../types";

// Display state of a key.
//   available — a real completion came back (可用)
//   no_quota  — the key authenticates but the account/key has no money left
//   error     — inconclusive: timeout, gateway page, WAF, upstream rate limit
//   dead      — the station rejected the key, or no model on it can serve
//   untested  — never tested yet
export type KeyState = "available" | "no_quota" | "error" | "dead" | "untested";

export function keyState(s: KeyStatus | null | undefined, accountBalance: number | null): KeyState {
  if (!s) return "untested";
  switch (s.state) {
    case "ok":
      return "available";
    case "no_quota":
      return "no_quota";
    case "error":
      return "error";
    case "dead":
      return "dead";
  }
  // Rows from before the state column: derive from alive + balance.
  if (s.alive == null) return "untested";
  if (s.alive !== 1) return "dead";
  if (accountBalance != null && accountBalance <= 0) return "no_quota";
  return "available";
}

export interface StateMeta {
  label: string;
  hint: string;
  dot: string; // bg color for dots / strips
  text: string;
  pill: string; // pill bg + ring
  accent: string; // card accent bar
}

export const STATE_META: Record<KeyState, StateMeta> = {
  available: {
    label: "可用",
    hint: "真实请求成功返回",
    dot: "bg-emerald-400",
    text: "text-emerald-300",
    pill: "bg-emerald-500/10 ring-emerald-400/30",
    accent: "from-emerald-400 to-primary-500",
  },
  no_quota: {
    label: "无额度",
    hint: "Key 有效，但账户/Key 余额已用尽",
    dot: "bg-amber-400",
    text: "text-amber-300",
    pill: "bg-amber-500/10 ring-amber-400/30",
    accent: "from-amber-400 to-amber-600",
  },
  error: {
    label: "检测异常",
    hint: "超时、网关错误、防护拦截或上游限流，未能得出结论，可稍后重测",
    dot: "bg-orange-400",
    text: "text-orange-300",
    pill: "bg-orange-500/10 ring-orange-400/30",
    accent: "from-orange-400 to-orange-600",
  },
  dead: {
    label: "不可用",
    hint: "Key 被拒绝，或没有任何可用模型/渠道",
    dot: "bg-rose-400",
    text: "text-rose-300",
    pill: "bg-rose-500/10 ring-rose-400/30",
    accent: "from-rose-400 to-rose-600",
  },
  untested: {
    label: "未测活",
    hint: "还没有测活记录",
    dot: "bg-dark-500",
    text: "text-dark-400",
    pill: "bg-white/[0.04] ring-white/10",
    accent: "from-dark-500 to-dark-600",
  },
};

export const STATE_ORDER: KeyState[] = ["available", "no_quota", "error", "dead", "untested"];
