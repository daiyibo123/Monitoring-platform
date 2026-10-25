import type { ReactNode } from "react";
import { Activity, CalendarCheck, Globe, KeyRound, Loader2, Square, Wallet } from "lucide-react";
import { formatTimeAgo, formatUsd } from "../lib/format";
import { STATE_META, STATE_ORDER, type KeyState } from "../lib/status";

export interface OverviewStats {
  sites: number;
  sitesUp: number;
  keys: number;
  byState: Record<KeyState, number>;
  totalBalance: number | null;
  sitesWithBalance: number;
  testedToday: number;
  lastTestedAt: number | null;
}

export interface RunInfo {
  label: string;
  total: number;
  done: number;
  current: string[];
}

export function Overview({ stats, run }: { stats: OverviewStats; run: RunInfo | null }) {
  const sitePct = stats.sites ? Math.round((stats.sitesUp / stats.sites) * 100) : 0;
  const todayPct = stats.keys ? Math.round((stats.testedToday / stats.keys) * 100) : 0;
  return (
    <section className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="概览">
      <Tile icon={Globe} label="可用网站" glow="bg-primary-500/20">
        <div className="flex items-center justify-between gap-3">
          <Big>
            {stats.sitesUp}
            <Small>/ {stats.sites}</Small>
          </Big>
          <Ring pct={sitePct} />
        </div>
        <Sub>至少一个 Key 真实请求成功</Sub>
      </Tile>
      <Tile icon={KeyRound} label="可用 Key" glow="bg-emerald-500/20">
        <Big>
          <span className="text-emerald-300">{stats.byState.available}</span>
          <Small>/ {stats.keys}</Small>
        </Big>
        <StateBar byState={stats.byState} total={stats.keys} />
      </Tile>
      <Tile icon={Wallet} label="总余额" glow="bg-cyan-500/20">
        <Big>
          <span className="text-gradient">{formatUsd(stats.totalBalance)}</span>
        </Big>
        <Sub>{stats.sitesWithBalance} 个网站有余额数据（网站级，不按 Key 叠加）</Sub>
      </Tile>
      <Tile icon={CalendarCheck} label="今日测活" glow="bg-sky-500/20">
        <Big>
          {stats.testedToday}
          <Small>/ {stats.keys}</Small>
        </Big>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
          <div className="h-full rounded-full bg-gradient-brand transition-all duration-500" style={{ width: `${todayPct}%` }} />
        </div>
        <Sub>{run ? `${run.label}进行中 ${run.done}/${run.total}` : `上次测活 ${formatTimeAgo(stats.lastTestedAt)} · 每天自动测一次`}</Sub>
      </Tile>
    </section>
  );
}

function Tile({ icon: Icon, label, glow, children }: { icon: typeof Globe; label: string; glow: string; children: ReactNode }) {
  return (
    <div className="card card-hover group relative min-w-0 overflow-hidden p-3.5 sm:p-4">
      <div className={`absolute -right-8 -top-8 h-24 w-24 rounded-full ${glow} blur-2xl transition-opacity duration-500 group-hover:opacity-80`} />
      <div className="relative">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-dark-400">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.05] text-primary-300 ring-1 ring-white/10">
            <Icon size={15} />
          </span>
          {label}
        </div>
        {children}
      </div>
    </div>
  );
}

const Big = ({ children }: { children: ReactNode }) => <div className="truncate font-mono text-xl font-bold text-white tabular sm:text-2xl">{children}</div>;
const Small = ({ children }: { children: ReactNode }) => <span className="ml-1 text-sm font-medium text-dark-500">{children}</span>;
const Sub = ({ children }: { children: ReactNode }) => <p className="mt-1.5 truncate text-[11px] text-dark-500">{children}</p>;

function Ring({ pct }: { pct: number }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" className="shrink-0 -rotate-90" aria-hidden>
      <circle cx="24" cy="24" r={r} fill="none" strokeWidth="5" className="stroke-white/[0.06]" />
      <circle cx="24" cy="24" r={r} fill="none" strokeWidth="5" strokeLinecap="round" stroke="url(#ringGrad)" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} className="transition-all duration-700" />
      <defs>
        <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2dd4bf" />
          <stop offset="1" stopColor="#38bdf8" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function StateBar({ byState, total }: { byState: Record<KeyState, number>; total: number }) {
  return (
    <>
      <div className="mt-2 flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-white/[0.05]">
        {total > 0 &&
          STATE_ORDER.map((st) =>
            byState[st] ? <div key={st} className={`${STATE_META[st].dot} transition-all duration-500`} style={{ width: `${(byState[st] / total) * 100}%` }} /> : null,
          )}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11px]">
        {STATE_ORDER.filter((st) => st !== "available" && byState[st] > 0).map((st) => (
          <span key={st} className={`flex items-center gap-1 ${STATE_META[st].text}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${STATE_META[st].dot}`} />
            {STATE_META[st].label} {byState[st]}
          </span>
        ))}
        {STATE_ORDER.every((st) => st === "available" || !byState[st]) && <span className="text-dark-500">全部可用</span>}
      </div>
    </>
  );
}

export function RunBar({ run, onStop }: { run: RunInfo; onStop: () => void }) {
  const pct = run.total ? Math.round((run.done / run.total) * 100) : 0;
  return (
    <div className="card relative animate-slide-up overflow-hidden px-4 py-3" role="status" aria-live="polite">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-500/15 text-primary-300 ring-1 ring-primary-400/30">
          <Loader2 size={16} className="animate-spin" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-medium text-dark-100">
            <Activity size={14} className="text-primary-300" />
            {run.label}
            <span className="font-mono text-xs text-dark-400 tabular">
              {run.done}/{run.total} · {pct}%
            </span>
          </p>
          <p className="truncate text-xs text-dark-500">{run.current.length ? `正在测：${run.current.join("、")}` : "准备中…"}</p>
        </div>
        <button onClick={onStop} className="btn-secondary btn-sm">
          <Square size={12} />
          停止
        </button>
      </div>
      <div className="relative mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
        <div className="h-full rounded-full bg-gradient-brand transition-all duration-500" style={{ width: `${pct}%` }} />
        <div className="absolute inset-y-0 left-0 w-1/3 animate-progress bg-gradient-to-r from-transparent via-white/30 to-transparent" />
      </div>
    </div>
  );
}
