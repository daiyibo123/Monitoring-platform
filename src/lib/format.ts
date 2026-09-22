export function formatRatio(r: number | null | undefined): string {
  if (r == null) return "—";
  // Trim trailing zeros: 1.00 -> 1, 0.80 -> 0.8
  return `${Number(r.toFixed(4))}x`;
}

export function formatUsd(v: number | null | undefined): string {
  if (v == null) return "—";
  return `$${v.toFixed(2)}`;
}

export function formatTimeAgo(unixSec: number | null | undefined): string {
  if (!unixSec) return "从未测活";
  const diff = Math.floor(Date.now() / 1000) - unixSec;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

export function maskKey(key: string): string {
  if (key.length <= 12) return key;
  return `${key.slice(0, 7)}••••${key.slice(-4)}`;
}
