import { useEffect, useState } from "react";
import { Activity, ChevronDown, Eye, EyeOff, Hourglass, Loader2, Pencil, Trash2 } from "lucide-react";
import type { ApiKey } from "../types";
import { CopyButton } from "./CopyButton";
import { KeyDetail } from "./KeyDetail";
import { useToast } from "./Toast";
import { formatMs, formatRatio } from "../lib/format";
import { PROVIDERS, type ProviderId } from "../lib/providers";
import { getKeySecret } from "../lib/secrets";
import { keyState, STATE_META, type KeyState } from "../lib/status";

const PILL = "inline-flex w-[5.25rem] shrink-0 items-center justify-center gap-1.5 rounded-md py-1 text-xs font-medium ring-1";

export function StatePill({ state, testing, queued }: { state: KeyState; testing?: boolean; queued?: boolean }) {
  if (testing) {
    return (
      <span className={`${PILL} bg-primary-500/10 text-primary-200 ring-primary-400/30`}>
        <Loader2 size={12} className="animate-spin" />
        测活中
      </span>
    );
  }
  if (queued) {
    return (
      <span className={`${PILL} bg-white/[0.04] text-dark-400 ring-white/10`}>
        <Hourglass size={12} />
        排队中
      </span>
    );
  }
  const m = STATE_META[state];
  return (
    <span className={`${PILL} ${m.pill} ${m.text}`} title={m.hint}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot} ${state === "available" ? "shadow-[0_0_8px_1px_rgba(52,211,153,0.8)]" : ""}`} />
      {m.label}
    </span>
  );
}

export function KeyRow({
  apiKey,
  editMode,
  provider,
  accountBalance,
  testing,
  queued,
  onTest,
  onEdit,
  onDelete,
}: {
  apiKey: ApiKey;
  editMode: boolean;
  provider: ProviderId | null;
  accountBalance: number | null; // site-level, shared by every key of the site
  testing: boolean;
  queued: boolean;
  onTest: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const toast = useToast();
  const [expanded, setExpanded] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const s = apiKey.status;
  const state = keyState(s, accountBalance);

  useEffect(() => setSecret(null), [apiKey.key_masked]);

  async function toggleReveal() {
    if (secret) {
      setSecret(null);
      return;
    }
    setRevealing(true);
    try {
      setSecret(await getKeySecret(apiKey.id));
    } catch (e) {
      toast(e instanceof Error ? e.message : "获取 Key 失败", "error");
    } finally {
      setRevealing(false);
    }
  }

  const keyLine = (
    <div className="flex min-w-0 items-center gap-0.5 rounded-lg bg-dark-950/50 py-0.5 pl-2.5 pr-0.5 ring-1 ring-white/[0.05]">
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-dark-400">{secret ?? apiKey.key_masked}</code>
      <button onClick={toggleReveal} className="icon-btn h-7 w-7" title={secret ? "隐藏" : "显示完整 Key"} aria-label={secret ? "隐藏 Key" : "显示完整 Key"}>
        {revealing ? <Loader2 size={13} className="animate-spin" /> : secret ? <EyeOff size={13} /> : <Eye size={13} />}
      </button>
      <CopyButton compact value={() => getKeySecret(apiKey.id)} label="Key" />
    </div>
  );

  return (
    <div className={`overflow-hidden rounded-xl bg-dark-900/50 ring-1 transition-colors hover:bg-dark-850/70 ${expanded ? "ring-primary-500/25" : "ring-white/[0.05] hover:ring-white/10"}`}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 px-3 py-2.5 sm:flex-nowrap sm:px-3.5">
        <StatePill state={state} testing={testing} queued={queued} />
        <div className="flex min-w-[8rem] flex-1 items-center gap-2">
          <span className="truncate text-sm font-semibold text-dark-50">{apiKey.label || apiKey.group_name || "未命名分组"}</span>
          {provider && provider !== "other" && <span className={`chip ${PROVIDERS[provider].badge}`}>{PROVIDERS[provider].label}</span>}
          {apiKey.group_name && <span className="chip-muted hidden font-mono sm:inline-flex">{apiKey.group_name}</span>}
        </div>
        <div className="hidden w-60 shrink-0 lg:block">{keyLine}</div>
        <span className="hidden w-14 shrink-0 text-right font-mono text-xs text-dark-500 tabular sm:block" title="真实请求延迟">
          {state === "available" ? formatMs(s?.latency_ms) : ""}
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-primary-500/10 px-2 py-1 ring-1 ring-primary-400/20" title="分组倍率">
          <span className="text-[11px] text-dark-400">倍率</span>
          <span className="font-mono text-sm font-bold text-primary-200 tabular">{formatRatio(s?.group_ratio)}</span>
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:ml-0">
          <button onClick={onTest} disabled={testing || queued} className="btn-secondary btn-sm">
            {testing ? <Loader2 size={13} className="animate-spin" /> : <Activity size={13} />}
            测活
          </button>
          {editMode && (
            <>
              <button onClick={onEdit} className="icon-btn" title="编辑" aria-label="编辑 Key">
                <Pencil size={14} />
              </button>
              <button onClick={onDelete} className="icon-btn hover:!text-rose-400" title="删除" aria-label="删除 Key">
                <Trash2 size={14} />
              </button>
            </>
          )}
          <button onClick={() => setExpanded((v) => !v)} className="icon-btn" aria-expanded={expanded} title="详情" aria-label="展开详情">
            <ChevronDown size={16} className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>
      {expanded && <KeyDetail apiKey={apiKey} state={state} keyLine={keyLine} />}
    </div>
  );
}
