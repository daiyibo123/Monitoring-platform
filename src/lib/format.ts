export function formatRatio(r: number | null | undefined): string {
  if (r == null) return "—";
  return `${Number(r.toFixed(4))}x`;
}

export function formatUsd(v: number | null | undefined): string {
  if (v == null) return "—";
  const abs = Math.abs(v);
  const s = abs >= 1000 ? abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : abs.toFixed(2);
  return `${v < 0 ? "-" : ""}$${s}`;
}

export function formatTimeAgo(unixSec: number | null | undefined): string {
  if (!unixSec) return "从未";
  const diff = Math.floor(Date.now() / 1000) - unixSec;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

export function formatMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

// Unix seconds of today's 00:00 in China time (UTC+8), same as the server.
export function chinaDayStart(nowMs = Date.now()): number {
  const shifted = Math.floor((nowMs + 8 * 3600 * 1000) / 86400000) * 86400000;
  return Math.floor((shifted - 8 * 3600 * 1000) / 1000);
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
