import { useMemo, useState } from "react";
import {
  Activity,
  ChevronRight,
  Globe,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Wallet,
} from "lucide-react";
import type { ApiKey, Site } from "../types";
import { CopyButton } from "./CopyButton";
import { KeyRow } from "./KeyRow";
import { formatUsd } from "../lib/format";
import { siteBalance } from "../lib/balance";
import { keyState } from "../lib/status";
import { detectProviders, PROVIDERS, type ProviderId } from "../lib/providers";

export function SiteCard({
  site,
  editMode,
  testingKeys,
  testingSite,
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
  testingSite: boolean;
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

  const total = site.keys.length;
  const balance = siteBalance(site);

  // Per-key three-state tally, so the header agrees with the row dots: a key
  // that answers but whose account balance is spent counts as 无额度, NOT 可用.
  // Balance is site-level, shared by every key on this site.
  const counts = useMemo(() => {
    let available = 0;
    let noQuota = 0;
    for (const k of site.keys) {
      const st = keyState(k.status?.alive, balance);
      if (st === "available") available++;
      else if (st === "no_quota") noQuota++;
    }
    return { available, noQuota };
  }, [site.keys, balance]);

  // Provider per key (from its accessible models), used for chips + filtering.
  const keyProviders = useMemo(() => {
    const map = new Map<number, ProviderId | null>();
    for (const k of site.keys) map.set(k.id, detectProviders(k.status?.models).primary);
    return map;
  }, [site.keys]);

  // Distinct channels present across the site's keys, for the chip row. Uses
  // each key's PRIMARY provider so the filter chips line up with visibleKeys'
  // primary-based filtering below.
  const channels = useMemo(() => {
    const set = new Set<ProviderId>();
    // Skip the "other" catch-all — we only surface recognised model families.
    for (const p of keyProviders.values()) if (p && p !== "other") set.add(p);
    return [...set];
  }, [keyProviders]);

  // If the selected channel no longer exists (its last key was deleted / re-tested
  // into another family, or dropped as "其它"), fall back to 全部 so the list can't
  // strand on an empty, un-resettable filter.
  const effectiveChannel = channel === "all" || channels.includes(channel) ? channel : "all";

  // ALL model families offered anywhere on the site — the union over every
  // key's full provider list, not just the primary. A single relay key often
  // exposes both GPT and Claude models; the header badges must show both, so
  // they read from this (ordered by how many keys back each family), while the
  // filter chips above stay primary-based.
  const families = useMemo(() => {
    const counts = new Map<ProviderId, number>();
    for (const k of site.keys) {
      for (const p of detectProviders(k.status?.models).providers) {
        // Only real model families in the header badges — never the "其它" bucket.
        if (p === "other") continue;
        counts.set(p, (counts.get(p) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  }, [site.keys]);

  // Keys sorted by group ratio (low -> high); null ratios last. Then filtered
  // by the selected channel. Sorting is derived (no persistence needed).
  const visibleKeys = useMemo(() => {
    const sorted = [...site.keys].sort((a, b) => {
      const ra = a.status?.group_ratio;
      const rb = b.status?.group_ratio;
      if (ra == null && rb == null) return 0;
      if (ra == null) return 1;
      if (rb == null) return -1;
      return ra - rb;
    });
    if (effectiveChannel === "all") return sorted;
    return sorted.filter((k) => keyProviders.get(k.id) === effectiveChannel);
  }, [site.keys, effectiveChannel, keyProviders]);

  return (
    <div className="card card-hover group relative overflow-hidden">
      {/* top accent line, brightens on hover */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-500/40 to-transparent opacity-60 transition-opacity duration-300 group-hover:opacity-100" />

      {/* site header — everything on one row (wraps only when truly cramped) */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/5 bg-white/[0.015] px-5 py-3.5">
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <ChevronRight
            size={19}
            className={`shrink-0 text-slate-500 transition-transform duration-200 ${collapsed ? "" : "rotate-90"}`}
          />
          <div className="relative shrink-0">
            <div className="absolute inset-0 rounded-xl bg-brand-grad opacity-30 blur-md" />
            <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600/20 ring-1 ring-brand-500/30">
              <Globe size={19} className="text-brand-300" />
            </div>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-base font-semibold text-white">{site.name}</h3>
              <span className="shrink-0 rounded-md bg-white/5 px-1.5 py-0.5 text-xs uppercase tracking-wide text-slate-400 ring-1 ring-white/5">
                {site.kind}
              </span>
            </div>
            <span className="mt-0.5 block truncate font-mono text-xs text-slate-500">{site.base_url}</span>
          </div>
        </button>

        {/* provider badges — what this site offers (GPT / Claude / …), shown
            in the header so it reads at a glance even while collapsed. */}
        {families.length > 0 && (
          <div className="hidden shrink-0 items-center gap-1.5 md:flex">
            {families.slice(0, 5).map((p) => (
              <span
                key={p}
                className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ${PROVIDERS[p].badge}`}
                title={`该站提供 ${PROVIDERS[p].label} 模型`}
              >
                {PROVIDERS[p].label}
              </span>
            ))}
            {families.length > 5 && (
              <span className="shrink-0 text-[11px] text-slate-500">+{families.length - 5}</span>
            )}
          </div>
        )}

        {/* summary + actions, all inline on the right */}
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1 text-sm ring-1 ring-white/5" title="可用 Key 数（有额度且可用）">
            <span className={`h-1.5 w-1.5 rounded-full ${counts.available > 0 ? "bg-emerald-400 shadow-[0_0_6px] shadow-emerald-400/70" : "bg-slate-600"}`} />
            <span className="font-semibold text-emerald-400">{counts.available}</span>
            <span className="text-slate-500">/{total}</span>
          </div>
          {counts.noQuota > 0 && (
            <div className="flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-2 py-1 text-sm ring-1 ring-amber-500/25" title="Key 可用，但账户余额已用尽">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              <span className="font-semibold text-amber-300">{counts.noQuota}</span>
              <span className="text-xs text-amber-400/80">无额度</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.07] px-2.5 py-1 shadow-glow-emerald" title="账户余额（网站级，只显示一次）">
            <Wallet size={15} className="text-emerald-400" />
            <span className="font-mono text-base font-bold text-emerald-300">{formatUsd(balance)}</span>
          </div>
          <CopyButton value={site.base_url} label="网址" />
          <button onClick={onTestSite} disabled={testingSite || total === 0} className="btn-ghost text-xs">
            {testingSite ? <Loader2 size={14} className="animate-spin" /> : <Activity size={14} />}
            全部测活
          </button>
          {editMode && (
            <>
              <button onClick={onAddKey} className="btn-ghost text-xs" title="添加 Key / 分组">
                <Plus size={14} />
                添加 Key
              </button>
              <button onClick={onEditSite} className="rounded-md p-1.5 text-slate-400 hover:bg-white/5 hover:text-white" title="编辑网站">
                <Pencil size={15} />
              </button>
              <button onClick={onDeleteSite} className="rounded-md p-1.5 text-slate-400 hover:bg-white/5 hover:text-rose-400" title="删除网站">
                <Trash2 size={15} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* keys */}
      {!collapsed && (
        <div className="space-y-2 p-4">
          {/* channel chips (choose which provider/model group to show) */}
          {channels.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5 pb-1">
              <span className="mr-0.5 text-[11px] text-slate-500">渠道</span>
              <ChannelChip active={effectiveChannel === "all"} onClick={() => setChannel("all")} label={`全部 ${total}`} />
              {channels.map((p) => (
                <ChannelChip
                  key={p}
                  active={effectiveChannel === p}
                  onClick={() => setChannel(p)}
                  label={PROVIDERS[p].label}
                  badge={PROVIDERS[p].badge}
                />
              ))}
            </div>
          )}

          {site.keys.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              {editMode ? "还没有 Key，点击右上角「添加 Key」" : "该网站还没有 Key"}
            </p>
          ) : visibleKeys.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">该渠道下暂无 Key</p>
          ) : (
            // One key per row; each key shows all its info on a single line.
            visibleKeys.map((k) => (
              <KeyRow
                key={k.id}
                apiKey={k}
                editMode={editMode}
                provider={keyProviders.get(k.id) ?? null}
                accountBalance={balance}
                testing={testingKeys.has(k.id)}
                onTest={() => onTestKey(k)}
                onEdit={() => onEditKey(k)}
                onDelete={() => onDeleteKey(k)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function ChannelChip({
  active,
  onClick,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  badge?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 transition-colors ${
        active
          ? "bg-brand-500/15 text-brand-300 ring-brand-500/40"
          : badge
            ? `${badge} opacity-70 hover:opacity-100`
            : "bg-white/5 text-slate-400 ring-white/10 hover:text-slate-200"
      }`}
    >
      {label}
    </button>
  );
}
