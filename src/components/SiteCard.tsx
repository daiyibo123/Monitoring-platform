import { useMemo, useState } from "react";
import { Activity, AlertTriangle, ChevronRight, Loader2, Pencil, Plus, StickyNote, Trash2, Wallet } from "lucide-react";
import type { ApiKey, Site } from "../types";
import { CopyButton } from "./CopyButton";
import { KeyRow } from "./KeyRow";
import { formatTimeAgo, formatUsd, hostOf } from "../lib/format";
import { siteBalance } from "../lib/balance";
import { sortKeys } from "../lib/sort";
import { keyState, STATE_META, STATE_ORDER, type KeyState } from "../lib/status";
import { detectProviders, PROVIDERS, type ProviderId } from "../lib/providers";

export function SiteCard({
  site,
  editMode,
  testingKeys,
  queuedKeys,
  busy,
  balanceLoading,
  onTestSite,
  onTestKey,
  onAddKey,
  onEditKey,
  onDeleteKey,
  onEditSite,
  onDeleteSite,
}: {
  site: Site;
  editMode: boolean;
  testingKeys: Set<number>;
  queuedKeys: Set<number>;
  busy: boolean;
  balanceLoading: boolean;
  onTestSite: () => void;
  onTestKey: (key: ApiKey) => void;
  onAddKey: () => void;
  onEditKey: (key: ApiKey) => void;
  onDeleteKey: (key: ApiKey) => void;
  onEditSite: () => void;
  onDeleteSite: () => void;
}) {
  const [collapsed, setCollapsed] = useState(true);
  const [channel, setChannel] = useState<ProviderId | "all">("all");
  const balance = siteBalance(site);
  const keys = useMemo(() => sortKeys(site), [site]);
  const states = useMemo(() => new Map(site.keys.map((k) => [k.id, keyState(k.status, balance)] as const)), [site.keys, balance]);
  const available = [...states.values()].filter((s) => s === "available").length;
  const best: KeyState = STATE_ORDER.find((st) => [...states.values()].includes(st)) ?? "untested";
  const accent = STATE_META[best];

  const keyProviders = useMemo(() => new Map(site.keys.map((k) => [k.id, detectProviders(k.status?.models).primary] as const)), [site.keys]);
  const channels = useMemo(() => [...new Set([...keyProviders.values()].filter((p): p is ProviderId => !!p && p !== "other"))], [keyProviders]);
  const families = useMemo(() => {
    const counts = new Map<ProviderId, number>();
    for (const k of site.keys) for (const p of detectProviders(k.status?.models).providers) if (p !== "other") counts.set(p, (counts.get(p) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  }, [site.keys]);
  const effective = channel === "all" || channels.includes(channel) ? channel : "all";
  const visible = effective === "all" ? keys : keys.filter((k) => keyProviders.get(k.id) === effective);
  const initial = Array.from(site.name.trim() || "?")[0].toUpperCase();

  return (
    <article className={`card card-hover group relative overflow-hidden ${available ? "" : "opacity-[0.92]"}`}>
      <span className={`absolute inset-y-0 left-0 w-1 bg-gradient-to-b ${accent.accent} ${available ? "shadow-[0_0_14px_rgba(52,211,153,0.6)]" : "opacity-70"}`} />
      <span className="shimmer-line absolute inset-x-0 top-0 h-px opacity-0 transition-opacity duration-500 group-hover:animate-shimmer group-hover:opacity-100" />

      <header className="flex flex-wrap items-center gap-x-4 gap-y-3 py-3.5 pl-5 pr-4">
        <button onClick={() => setCollapsed((v) => !v)} className="flex min-w-0 grow basis-full items-center gap-3 text-left sm:basis-0" aria-expanded={!collapsed}>
          <ChevronRight size={18} className={`shrink-0 text-dark-500 transition-transform duration-200 ${collapsed ? "" : "rotate-90 text-primary-300"}`} />
          <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500/25 to-cyan-500/10 text-lg font-bold text-primary-200 ring-1 ring-primary-400/25">
            {initial}
            <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3">
              {available > 0 && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
              <span className={`relative inline-flex h-3 w-3 rounded-full ring-2 ring-dark-900 ${accent.dot}`} />
            </span>
          </span>
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="truncate text-base font-semibold text-white">{site.name}</span>
              <span className="chip-muted uppercase tracking-wide">{site.kind}</span>
              {families.slice(0, 4).map((p) => (
                <span key={p} className={`chip hidden md:inline-flex ${PROVIDERS[p].badge}`}>
                  {PROVIDERS[p].label}
                </span>
              ))}
            </span>
            <span className="mt-0.5 block truncate font-mono text-xs text-dark-500" title={site.base_url}>
              {hostOf(site.base_url)}
            </span>
          </span>
        </button>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-2.5 py-1.5 ring-1 ring-white/[0.06]" title="可用 Key / 全部 Key">
            <span className="flex h-3.5 items-end gap-[3px]" aria-hidden>
              {keys.slice(0, 12).map((k) => (
                <span key={k.id} className={`h-full w-1 rounded-full ${STATE_META[states.get(k.id) ?? "untested"].dot}`} />
              ))}
            </span>
            <span className="font-mono text-sm tabular">
              <span className={available ? "font-bold text-emerald-300" : "text-dark-400"}>{available}</span>
              <span className="text-dark-500">/{site.keys.length}</span>
            </span>
          </span>
          <BalanceBlock site={site} balance={balance} loading={balanceLoading} />
          <CopyButton compact value={site.base_url} label="网址" />
          <button onClick={onTestSite} disabled={busy || site.keys.length === 0} className="btn-secondary btn-sm">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Activity size={13} />}
            测活
          </button>
          {editMode && (
            <>
              <button onClick={onAddKey} className="icon-btn" title="添加 Key" aria-label="添加 Key">
                <Plus size={16} />
              </button>
              <button onClick={onEditSite} className="icon-btn" title="编辑网站" aria-label="编辑网站">
                <Pencil size={15} />
              </button>
              <button onClick={onDeleteSite} className="icon-btn hover:!text-rose-400" title="删除网站" aria-label="删除网站">
                <Trash2 size={15} />
              </button>
            </>
          )}
        </div>
      </header>

      {!collapsed && (
        <div className="animate-fade-in space-y-2 border-t border-white/[0.05] bg-dark-950/20 px-4 pb-4 pt-3">
          {(site.note || site.balance?.error) && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 pb-1 text-xs">
              {site.note && (
                <span className="flex items-center gap-1.5 text-dark-400">
                  <StickyNote size={13} />
                  {site.note}
                </span>
              )}
              {site.balance?.error && (
                <span className="flex items-center gap-1.5 text-amber-300/90">
                  <AlertTriangle size={13} />
                  余额读取失败（{formatTimeAgo(site.balance.checked_at)}）：{site.balance.error}
                </span>
              )}
            </div>
          )}
          {channels.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5 pb-1">
              <span className="mr-0.5 text-[11px] text-dark-500">渠道</span>
              <Chip active={effective === "all"} onClick={() => setChannel("all")} label={`全部 ${site.keys.length}`} />
              {channels.map((p) => (
                <Chip key={p} active={effective === p} onClick={() => setChannel(p)} label={PROVIDERS[p].label} />
              ))}
            </div>
          )}
          {site.keys.length === 0 ? (
            <p className="py-6 text-center text-sm text-dark-500">{editMode ? "还没有 Key，点击右上角「+」添加" : "该网站还没有 Key"}</p>
          ) : (
            visible.map((k) => (
              <KeyRow
                key={k.id}
                apiKey={k}
                editMode={editMode}
                provider={keyProviders.get(k.id) ?? null}
                accountBalance={balance}
                testing={testingKeys.has(k.id)}
                queued={queuedKeys.has(k.id)}
                onTest={() => onTestKey(k)}
                onEdit={() => onEditKey(k)}
                onDelete={() => onDeleteKey(k)}
              />
            ))
          )}
        </div>
      )}
    </article>
  );
}

function BalanceBlock({ site, balance, loading }: { site: Site; balance: number | null; loading: boolean }) {
  const b = site.balance;
  const tone = balance == null ? "text-dark-400" : balance > 0 ? "text-emerald-300" : "text-amber-300";
  const box =
    balance == null
      ? "border-white/[0.07] bg-white/[0.02] text-dark-500"
      : balance > 0
        ? "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-400/80"
        : "border-amber-500/25 bg-amber-500/[0.06] text-amber-400/80";
  const title = b?.unlimited
    ? "该 Key 未设额度上限，读不到账户真实余额（New-API 可填写访问令牌读取）"
    : b?.error
      ? `余额读取失败：${b.error}`
      : `账户余额（网站级）${b?.usage_usd != null ? ` · 已用 ${formatUsd(b.usage_usd)}` : ""}${b?.ok_at ? ` · ${formatTimeAgo(b.ok_at)}更新` : ""}`;
  return (
    <span className={`flex min-w-[6.5rem] items-center justify-end gap-1.5 rounded-lg border px-2.5 py-1 ${box}`} title={title}>
      {loading ? <Loader2 size={14} className="animate-spin" /> : <Wallet size={14} />}
      <span className={`font-mono text-base font-bold tabular ${tone}`}>{b?.unlimited && balance == null ? "不限额" : formatUsd(balance)}</span>
      {b?.error && <AlertTriangle size={12} className="text-amber-400" />}
    </span>
  );
}

function Chip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 transition-colors ${
        active ? "bg-primary-500/15 text-primary-200 ring-primary-400/40" : "bg-white/[0.03] text-dark-400 ring-white/10 hover:text-dark-100"
      }`}
    >
      {label}
    </button>
  );
}
