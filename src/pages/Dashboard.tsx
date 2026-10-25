import { useMemo, useState, type FormEvent } from "react";
import { Activity, ArrowDownWideNarrow, Eye, KeyRound, Loader2, Lock, LockOpen, LogOut, Pencil, Plus, RefreshCw, Sparkles } from "lucide-react";
import { api, UnauthorizedError } from "../api";
import type { ApiKey, KeyInput, Site, SiteInput } from "../types";
import { useToast } from "../components/Toast";
import { Backdrop, BrandMark } from "../components/Backdrop";
import { Overview, RunBar } from "../components/Overview";
import { SiteCard } from "../components/SiteCard";
import { SiteFormModal } from "../components/SiteFormModal";
import { KeyFormModal } from "../components/KeyFormModal";
import { Modal } from "../components/Modal";
import { forgetKeySecret } from "../lib/secrets";
import { sortSites } from "../lib/sort";
import { STATE_META } from "../lib/status";
import { useDashboard } from "./useDashboard";

export function Dashboard({ edit, onEditChange, onLogout }: { edit: boolean; onEditChange: (edit: boolean) => void; onLogout: () => void }) {
  const toast = useToast();
  const d = useDashboard(onLogout);
  const [siteModal, setSiteModal] = useState<{ site: Site | null } | null>(null);
  const [keyModal, setKeyModal] = useState<{ siteId: number; key: ApiKey | null } | null>(null);
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);

  const sorted = useMemo(() => sortSites(d.sites), [d.sites]);
  const siteBusy = (s: Site) => d.busy || s.keys.some((k) => d.testing.has(k.id) || d.queued.has(k.id));

  // Errors from modals surface in the form; a lost session logs out instead.
  async function guarded(fn: () => Promise<void>) {
    try {
      await fn();
    } catch (err) {
      if (err instanceof UnauthorizedError) onLogout();
      throw err;
    }
  }

  const saveSite = (data: SiteInput) =>
    guarded(async () => {
      if (siteModal?.site) await api.updateSite(siteModal.site.id, data);
      else await api.createSite(data);
      await d.load();
      toast(siteModal?.site ? "网站已更新" : "网站已添加", "success");
    });

  const saveKey = (siteId: number, key: ApiKey | null, data: KeyInput) =>
    guarded(async () => {
      let retest: number | null = null;
      if (key) {
        const r = await api.updateKey(key.id, data);
        if (r.key_changed) forgetKeySecret(key.id);
        if (r.key_changed || r.probe_changed || data.group_name !== key.group_name) retest = key.id;
      } else {
        retest = (await api.createKey({ site_id: siteId, ...data })).id;
      }
      await d.load();
      toast(key ? "Key 已更新" : "Key 已添加", "success");
      if (retest != null) void d.testOne(retest);
    });

  async function deleteSite(site: Site) {
    if (!confirm(`确认删除网站「${site.name}」及其下所有 Key？此操作不可恢复。`)) return;
    try {
      await api.deleteSite(site.id);
      site.keys.forEach((k) => forgetKeySecret(k.id));
      await d.load();
      toast("网站已删除", "success");
    } catch (err) {
      if (err instanceof UnauthorizedError) onLogout();
      else toast(err instanceof Error ? err.message : "删除失败", "error");
    }
  }

  async function deleteKey(key: ApiKey) {
    if (!confirm(`确认删除 Key「${key.label || key.group_name || key.key_masked}」？`)) return;
    try {
      await api.deleteKey(key.id);
      forgetKeySecret(key.id);
      await d.load();
      toast("Key 已删除", "success");
    } catch (err) {
      if (err instanceof UnauthorizedError) onLogout();
      else toast(err instanceof Error ? err.message : "删除失败", "error");
    }
  }

  async function submitUnlock(e: FormEvent) {
    e.preventDefault();
    setUnlockError(null);
    setUnlocking(true);
    try {
      await api.unlock(password);
      onEditChange(true);
      setUnlockOpen(false);
      setPassword("");
      toast("已进入编辑模式", "success");
    } catch (err) {
      if (err instanceof UnauthorizedError) onLogout();
      else setUnlockError(err instanceof Error ? err.message : "解锁失败");
    } finally {
      setUnlocking(false);
    }
  }

  async function exitEdit() {
    try {
      await api.lock();
      onEditChange(false);
      toast("已退出编辑模式", "success");
    } catch (err) {
      if (err instanceof UnauthorizedError) onLogout();
      else toast(err instanceof Error ? err.message : "操作失败", "error");
    }
  }

  async function logout() {
    try {
      await api.logout();
    } finally {
      onLogout();
    }
  }

  return (
    <div className="relative min-h-screen">
      <Backdrop />

      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-dark-950/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1180px] items-center gap-2.5 px-3 py-3 sm:gap-3 sm:px-6">
          <BrandMark size={36} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-base font-bold tracking-tight text-gradient sm:text-xl">中转站监控平台</h1>
              <span className={`chip hidden sm:inline-flex ${edit ? "bg-primary-500/15 text-primary-200 ring-primary-400/35" : "bg-white/[0.04] text-dark-300 ring-white/10"}`}>
                {edit ? <LockOpen size={11} /> : <Eye size={11} />}
                {edit ? "编辑模式" : "查看模式"}
              </span>
            </div>
            <p className="hidden truncate text-xs text-dark-500 sm:block">可用性 · 分组倍率 · 账户余额，一屏掌握</p>
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
            <button onClick={d.testAll} disabled={d.busy || !d.stats.keys} className="btn-primary !px-3 sm:!px-3.5">
              {d.run ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              <span className="hidden sm:inline">全部测活</span>
              <span className="sm:hidden">测活</span>
            </button>
            <button onClick={d.refreshAll} disabled={d.busy} className="btn-secondary !px-2.5 sm:!px-3.5" title="刷新全部余额">
              <RefreshCw size={16} className={d.refreshing ? "animate-spin" : ""} />
              <span className="hidden md:inline">刷新余额</span>
            </button>
            {edit && (
              <button onClick={() => setSiteModal({ site: null })} className="btn-secondary !px-2.5 sm:!px-3.5" title="添加网站">
                <Plus size={16} />
                <span className="hidden md:inline">添加网站</span>
              </button>
            )}
            {edit ? (
              <button onClick={exitEdit} className="btn-ghost !px-2.5" title="退出编辑模式" aria-label="退出编辑模式">
                <Lock size={16} />
              </button>
            ) : (
              <button
                onClick={() => {
                  setPassword("");
                  setUnlockError(null);
                  setUnlockOpen(true);
                }}
                className="btn-ghost !px-2.5"
                title="解锁编辑模式"
                aria-label="解锁编辑模式"
              >
                <Pencil size={16} />
              </button>
            )}
            <button onClick={logout} className="btn-ghost !px-2.5" title="退出登录" aria-label="退出登录">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-[1180px] space-y-5 px-4 py-6 sm:px-6">
        <Overview stats={d.stats} run={d.run} />
        {d.run && <RunBar run={d.run} onStop={d.stop} />}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-dark-200">
            <Activity size={15} className="text-primary-300" />
            中转站
            <span className="font-mono text-xs font-normal text-dark-500">{d.sites.length}</span>
          </h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-dark-500">
            <span className="flex items-center gap-1">
              <ArrowDownWideNarrow size={13} />
              可用在前 · 同类按余额从高到低
            </span>
            {(["available", "no_quota", "error", "dead"] as const).map((st) => (
              <span key={st} className="flex items-center gap-1" title={STATE_META[st].hint}>
                <span className={`h-1.5 w-1.5 rounded-full ${STATE_META[st].dot}`} />
                {STATE_META[st].label}
              </span>
            ))}
          </div>
        </div>

        {d.loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="card h-[74px] overflow-hidden">
                <div className="shimmer-line h-full w-full animate-shimmer opacity-[0.06]" />
              </div>
            ))}
          </div>
        ) : d.sites.length === 0 ? (
          <div className="card flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-500/10 text-primary-300 ring-1 ring-primary-400/25">
              <KeyRound size={24} />
            </div>
            <p className="text-dark-200">还没有添加任何中转站</p>
            {edit ? (
              <button onClick={() => setSiteModal({ site: null })} className="btn-primary mt-1">
                <Plus size={16} />
                添加第一个网站
              </button>
            ) : (
              <p className="text-sm text-dark-500">点击右上角「编辑」解锁后即可添加</p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {sorted.map((site, i) => (
              <div key={site.id} className="animate-slide-up" style={{ animationDelay: `${Math.min(i * 50, 400)}ms`, animationFillMode: "backwards" }}>
                <SiteCard
                  site={site}
                  editMode={edit}
                  testingKeys={d.testing}
                  queuedKeys={d.queued}
                  busy={siteBusy(site)}
                  balanceLoading={d.balanceBusy.has(site.id)}
                  onTestSite={() => d.testSite(site)}
                  onTestKey={(k) => d.testOne(k.id)}
                  onAddKey={() => setKeyModal({ siteId: site.id, key: null })}
                  onEditKey={(k) => setKeyModal({ siteId: site.id, key: k })}
                  onDeleteKey={deleteKey}
                  onEditSite={() => setSiteModal({ site })}
                  onDeleteSite={() => deleteSite(site)}
                />
              </div>
            ))}
          </div>
        )}
        <p className="pb-4 pt-2 text-center text-[11px] text-dark-600">测活 = 用最便宜的模型发一次真实 "hi" 请求（max_tokens=1），只有真正返回补全才算可用</p>
      </main>

      {siteModal && <SiteFormModal site={siteModal.site} onClose={() => setSiteModal(null)} onSubmit={saveSite} />}
      {keyModal && <KeyFormModal apiKey={keyModal.key} onClose={() => setKeyModal(null)} onSubmit={(data) => saveKey(keyModal.siteId, keyModal.key, data)} />}
      {unlockOpen && (
        <Modal title="解锁编辑模式" icon={<LockOpen size={18} />} onClose={() => setUnlockOpen(false)}>
          <form onSubmit={submitUnlock} className="space-y-4">
            <p className="text-sm text-dark-400">再次输入登录密码以启用增删改功能。</p>
            <div className="relative">
              <KeyRound size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-dark-500" />
              <input
                type="password"
                autoFocus
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="input pl-9"
                aria-label="密码"
              />
            </div>
            {unlockError && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300 ring-1 ring-rose-500/20">{unlockError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setUnlockOpen(false)} className="btn-ghost">
                取消
              </button>
              <button type="submit" disabled={unlocking || !password} className="btn-primary">
                {unlocking ? <Loader2 size={16} className="animate-spin" /> : <LockOpen size={16} />}
                {unlocking ? "解锁中..." : "解锁"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
