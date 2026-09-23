import { useState } from "react";
import {
  Activity,
  ChevronDown,
  Eye,
  EyeOff,
  Loader2,
  Pencil,
  Trash2,
} from "lucide-react";
import type { ApiKey } from "../types";
import { CopyButton } from "./CopyButton";
import { formatRatio, formatTimeAgo, formatUsd, maskKey } from "../lib/format";
import { PROVIDERS, type ProviderId } from "../lib/providers";
import { keyState, STATE_META, type KeyState } from "../lib/status";

function StatusDot({ state }: { state: KeyState }) {
  const m = STATE_META[state];
  return (
    <span className="inline-flex items-center gap-1.5" title={state === "no_quota" ? "Key 可用，但账户余额已用尽" : undefined}>
      <span className={`h-2 w-2 rounded-full ${m.dot} ${m.glow ? "shadow-[0_0_8px] shadow-emerald-400/60" : ""}`} />
      <span className={m.text}>{m.label}</span>
    </span>
  );
}

function ProviderBadge({ provider }: { provider: ProviderId | null }) {
  // "other" (其它) is an unrecognised-model catch-all — don't badge it.
  if (!provider || provider === "other") return null;
  const meta = PROVIDERS[provider];
  return (
    <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ${meta.badge}`}>
      {meta.label}
    </span>
  );
}

export function KeyRow({
  apiKey,
  editMode,
  provider,
  accountBalance,
  testing,
  onTest,
  onEdit,
  onDelete,
  className = "",
}: {
  apiKey: ApiKey;
  editMode: boolean;
  provider: ProviderId | null;
  // Site-level account balance, shared by all keys — decides 无额度 vs 可用.
  accountBalance: number | null;
  testing: boolean;
  onTest: () => void;
  onEdit: () => void;
  onDelete: () => void;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const s = apiKey.status;
  const ratios = s?.model_ratios ?? [];
  const state = keyState(s?.alive, accountBalance);

  return (
    <div className={`rounded-xl border border-white/5 bg-ink-900/50 transition-colors hover:border-white/10 hover:bg-ink-900/80 ${className}`}>
      {/* single row: identity · masked key · latency · ratio · actions · expand */}
      <div className="flex items-center gap-2 px-4 py-2.5">
        {/* identity */}
        <div className="flex min-w-0 shrink items-center gap-2">
          <StatusDot state={state} />
          <span className="truncate text-sm font-semibold text-slate-100">
            {apiKey.label || apiKey.group_name || "未命名分组"}
          </span>
          <ProviderBadge provider={provider} />
          {apiKey.group_name && (
            <span className="hidden shrink-0 rounded-md bg-white/5 px-1.5 py-0.5 text-xs text-slate-400 sm:inline">
              {apiKey.group_name}
            </span>
          )}
        </div>

        {/* masked key (flexible middle, hidden on narrow screens) */}
        <div className="hidden min-w-0 flex-1 items-center gap-1 lg:flex">
          <code className="truncate font-mono text-xs text-slate-500">
            {revealed ? apiKey.api_key : maskKey(apiKey.api_key)}
          </code>
          <button
            onClick={() => setRevealed((v) => !v)}
            className="shrink-0 rounded-md p-1 text-slate-500 hover:text-slate-300"
            title={revealed ? "隐藏" : "显示"}
          >
            {revealed ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        </div>

        {/* latency (right-anchored; sits before the ratio pill) */}
        <span className="ml-auto hidden shrink-0 text-xs text-slate-500 sm:block lg:ml-0">
          {s?.latency_ms != null ? `${s.latency_ms}ms` : ""}
        </span>

        {/* group ratio (倍率) — balance intentionally shown at site level only */}
        <div className="flex shrink-0 items-center gap-1 rounded-lg bg-brand-500/10 px-2 py-1 text-sm ring-1 ring-brand-500/20" title="分组倍率">
          <Activity size={13} className="text-brand-400" />
          <span className="text-slate-400">倍率</span>
          <span className="font-mono text-sm font-bold text-brand-300">{formatRatio(s?.group_ratio)}</span>
        </div>

        {/* actions — expand chevron last */}
        <div className="flex shrink-0 items-center gap-1">
          <CopyButton value={apiKey.api_key} label="Key" />
          <button onClick={onTest} disabled={testing} className="btn-ghost px-2 py-1 text-xs">
            {testing ? <Loader2 size={13} className="animate-spin" /> : <Activity size={13} />}
            测活
          </button>
          {editMode && (
            <>
              <button onClick={onEdit} className="rounded-md p-1.5 text-slate-400 hover:bg-white/5 hover:text-white" title="编辑">
                <Pencil size={14} />
              </button>
              <button onClick={onDelete} className="rounded-md p-1.5 text-slate-400 hover:bg-white/5 hover:text-rose-400" title="删除">
                <Trash2 size={14} />
              </button>
            </>
          )}
          <button
            onClick={() => setExpanded((v) => !v)}
            className="rounded-md p-1.5 text-slate-400 hover:bg-white/5 hover:text-white"
            title="详情"
          >
            <ChevronDown size={16} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {/* expanded detail */}
      {expanded && (
        <div className="space-y-3 border-t border-white/5 bg-ink-950/40 px-4 py-3">
          {s?.error && (
            <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              错误：{s.error}
            </p>
          )}

          {/* full key line (also covers narrow screens where the row hides it) */}
          <div className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 lg:hidden">
            <code className="flex-1 truncate font-mono text-xs text-slate-400">
              {revealed ? apiKey.api_key : maskKey(apiKey.api_key)}
            </code>
            <button
              onClick={() => setRevealed((v) => !v)}
              className="shrink-0 rounded-md p-1 text-slate-500 hover:text-slate-300"
              title={revealed ? "隐藏" : "显示"}
            >
              {revealed ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          </div>

          {/* 账户余额是网站级属性，已在网站栏显示，这里不再重复 */}
          <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            <Stat label="分组倍率" value={formatRatio(s?.group_ratio)} />
            <Stat label="已用额度" value={formatUsd(s?.total_usage_usd)} />
            <Stat label="可用模型" value={s ? `${s.models.length} 个` : "—"} />
            <Stat label="上次测活" value={s?.tested_at != null ? formatTimeAgo(s.tested_at) : "—"} />
          </div>

          {ratios.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-slate-400">
                模型倍率（数据源：{s?.pricing_source === "sub2api-billing" ? "sub2api" : "pricing"}）
              </p>
              <div className="scrollbar-thin max-h-40 overflow-auto rounded-lg border border-white/5">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-ink-800 text-slate-400">
                    <tr>
                      <th className="px-3 py-1.5 font-medium">模型</th>
                      <th className="px-3 py-1.5 font-medium">模型倍率</th>
                      <th className="px-3 py-1.5 font-medium">补全倍率</th>
                      <th className="px-3 py-1.5 font-medium">计费</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ratios.map((r) => (
                      <tr key={r.model} className="border-t border-white/5">
                        <td className="px-3 py-1.5 font-mono text-slate-300">{r.model}</td>
                        <td className="px-3 py-1.5 font-mono text-brand-400">
                          {r.quota_type === 1 ? "—" : formatRatio(r.model_ratio)}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-slate-400">
                          {r.quota_type === 1 ? "—" : formatRatio(r.completion_ratio)}
                        </td>
                        <td className="px-3 py-1.5 text-slate-400">
                          {r.quota_type === 1 ? `按次 $${r.model_price ?? "?"}` : "按量"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {s && s.models.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-slate-400">可用模型</p>
              <div className="flex flex-wrap gap-1.5">
                {s.models.slice(0, 40).map((m) => (
                  <span key={m} className="rounded-md bg-white/5 px-2 py-0.5 font-mono text-[11px] text-slate-300">
                    {m}
                  </span>
                ))}
                {s.models.length > 40 && (
                  <span className="px-2 py-0.5 text-[11px] text-slate-500">+{s.models.length - 40}</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-white/5 px-3 py-2">
      <div className="flex items-center gap-1 text-slate-500">
        {label}
        {hint && <span className="rounded bg-white/5 px-1 text-[10px] text-slate-600">{hint}</span>}
      </div>
      <div className="mt-0.5 font-mono font-semibold text-slate-200">{value}</div>
    </div>
  );
}
