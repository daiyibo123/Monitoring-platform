import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight } from "lucide-react";
import type { ApiKey, ProbeAttempt } from "../types";
import { formatMs, formatRatio, formatTimeAgo, formatUsd } from "../lib/format";
import type { KeyState } from "../lib/status";

const MUTED = "text-dark-300 bg-white/[0.04] ring-white/10";
const ORANGE = "text-orange-300 bg-orange-500/10 ring-orange-400/25";
const OUTCOME: Record<string, { label: string; tone: string }> = {
  ok: { label: "成功", tone: "text-emerald-300 bg-emerald-500/10 ring-emerald-400/25" },
  drained: { label: "余额不足", tone: "text-amber-300 bg-amber-500/10 ring-amber-400/25" },
  dead: { label: "被拒绝", tone: "text-rose-300 bg-rose-500/10 ring-rose-400/25" },
  modelIssue: { label: "模型不可用", tone: MUTED },
  endpoint: { label: "接口不支持", tone: MUTED },
  param: { label: "参数不兼容", tone: MUTED },
  stream: { label: "需流式", tone: MUTED },
  ccVersion: { label: "版本校验", tone: MUTED },
  ccOnly: { label: "仅限 Claude Code", tone: ORANGE },
  rateLimited: { label: "限流", tone: ORANGE },
  blocked: { label: "被拦截", tone: ORANGE },
  transient: { label: "超时/网关", tone: ORANGE },
  internal: { label: "平台限制", tone: ORANGE },
  other: { label: "失败", tone: MUTED },
};

const ERROR_TONE: Partial<Record<KeyState, string>> = {
  no_quota: "bg-amber-500/10 text-amber-200 ring-amber-400/20",
  error: "bg-orange-500/10 text-orange-200 ring-orange-400/20",
};

export function KeyDetail({ apiKey, state, keyLine }: { apiKey: ApiKey; state: KeyState; keyLine: ReactNode }) {
  const s = apiKey.status;
  const probe = s?.probe;
  const ratios = s?.model_ratios ?? [];

  return (
    <div className="animate-fade-in space-y-3 border-t border-white/[0.05] px-3.5 pb-3.5 pt-3">
      {s?.error && (
        <p className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs leading-relaxed ring-1 ${ERROR_TONE[state] ?? "bg-rose-500/10 text-rose-200 ring-rose-400/20"}`}>
          <AlertTriangle size={14} className="mt-px shrink-0" />
          <span className="break-all">{s.error}</span>
        </p>
      )}
      {state === "available" && probe?.model && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-emerald-300/90">
          <CheckCircle2 size={14} />
          <span>真实请求成功</span>
          <code className="font-mono text-emerald-200/80">{probe.endpoint}</code>
          <code className="font-mono text-emerald-200/80">{probe.model}</code>
          <span className="font-mono">{formatMs(s?.latency_ms)}</span>
        </p>
      )}

      <div className="lg:hidden">{keyLine}</div>

      <div className={`grid grid-cols-2 gap-2 ${s?.total_usage_usd != null ? "sm:grid-cols-5" : "sm:grid-cols-4"}`}>
        <Stat label="分组倍率" value={formatRatio(s?.group_ratio)} />
        <Stat label="请求延迟" value={state === "available" ? formatMs(s?.latency_ms) : "—"} />
        <Stat label="可用模型" value={s ? `${s.models.length} 个` : "—"} />
        <Stat label="上次测活" value={formatTimeAgo(s?.tested_at)} />
        {s?.total_usage_usd != null && <Stat label="已用额度" value={formatUsd(s.total_usage_usd)} />}
      </div>

      {probe && probe.attempts.length > 0 && <Attempts attempts={probe.attempts} />}

      {ratios.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-dark-400">模型倍率（数据源：{s?.pricing_source === "sub2api-billing" ? "sub2api" : "pricing"}）</p>
          <div className="max-h-44 overflow-auto rounded-lg ring-1 ring-white/[0.06] scrollbar-thin">
            <table className="w-full whitespace-nowrap text-left text-xs">
              <thead className="sticky top-0 bg-dark-800/95 text-dark-400 backdrop-blur">
                <tr>
                  <th className="px-3 py-1.5 font-medium">模型</th>
                  <th className="px-3 py-1.5 font-medium">模型倍率</th>
                  <th className="px-3 py-1.5 font-medium">补全倍率</th>
                  <th className="px-3 py-1.5 font-medium">计费</th>
                </tr>
              </thead>
              <tbody>
                {ratios.map((r) => (
                  <tr key={r.model} className="border-t border-white/[0.04] hover:bg-white/[0.02]">
                    <td className="px-3 py-1.5 font-mono text-dark-200">{r.model}</td>
                    <td className="px-3 py-1.5 font-mono text-primary-300">{r.quota_type === 1 ? "—" : formatRatio(r.model_ratio)}</td>
                    <td className="px-3 py-1.5 font-mono text-dark-300">{r.quota_type === 1 ? "—" : formatRatio(r.completion_ratio)}</td>
                    <td className="px-3 py-1.5 text-dark-400">{r.quota_type === 1 ? `按次 $${r.model_price ?? "?"}` : "按量"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {s && s.models.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-dark-400">可用模型</p>
          <div className="flex flex-wrap gap-1.5">
            {s.models.slice(0, 48).map((m) => (
              <span key={m} className="rounded-md bg-white/[0.04] px-2 py-0.5 font-mono text-[11px] text-dark-300 ring-1 ring-white/[0.05]">
                {m}
              </span>
            ))}
            {s.models.length > 48 && <span className="px-2 py-0.5 text-[11px] text-dark-500">+{s.models.length - 48}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function Attempts({ attempts }: { attempts: ProbeAttempt[] }) {
  return (
    <details className="group rounded-lg bg-dark-950/40 ring-1 ring-white/[0.05]">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-xs text-dark-400 hover:text-dark-200 [&::-webkit-details-marker]:hidden">
        <ChevronRight size={13} className="transition-transform group-open:rotate-90" />
        探测记录（{attempts.length} 次请求）
      </summary>
      <ul className="space-y-1 px-3 pb-2.5">
        {attempts.map((a, i) => {
          const o = OUTCOME[a.outcome] ?? OUTCOME.other;
          return (
            <li key={i} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
              <span className={`chip ${o.tone}`}>{o.label}</span>
              <code className="font-mono text-dark-300">{a.endpoint}</code>
              <code className="font-mono text-dark-400">{a.model}</code>
              <span className="font-mono text-dark-500">{a.status || "—"}</span>
              <span className="font-mono text-dark-500">{formatMs(a.ms)}</span>
              {a.note && (
                <span className="min-w-0 basis-full truncate text-dark-500 sm:basis-auto sm:flex-1" title={a.note}>
                  {a.note}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/[0.03] px-3 py-2 ring-1 ring-white/[0.05]">
      <div className="text-[11px] text-dark-500">{label}</div>
      <div className="mt-0.5 font-mono text-sm font-semibold text-dark-100 tabular">{value}</div>
    </div>
  );
}
