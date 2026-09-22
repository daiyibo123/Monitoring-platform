import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Activity, Eye, Globe, KeyRound, Loader2, Lock, LockOpen, LogOut, Pencil, Plus, RefreshCw, ShieldCheck, Wallet } from "lucide-react";
import { api, UnauthorizedError } from "../api";
import type { ApiKey, Site, SiteKind } from "../types";
import { useToast } from "../components/Toast";
import { SiteCard } from "../components/SiteCard";
import { SiteFormModal } from "../components/SiteFormModal";
import { KeyFormModal } from "../components/KeyFormModal";
import { Modal } from "../components/Modal";
import { formatUsd } from "../lib/format";
import { siteBalance } from "../lib/balance";

export function Dashboard({
  edit: editMode,
  onEditChange,
  onLogout,
}: {
  edit: boolean;
  onEditChange: (edit: boolean) => void;
  onLogout: () => void;
}) {
  const toast = useToast();
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [testingKeys, setTestingKeys] = useState<Set<number>>(new Set());
  const [testingSites, setTestingSites] = useState<Set<number>>(new Set());

  const [siteModal, setSiteModal] = useState<{ open: boolean; site: Site | null }>({ open: false, site: null });
  const [keyModal, setKeyModal] = useState<{ open: boolean; siteId: number; key: ApiKey | null } | null>(null);

  // Edit-mode unlock modal (re-enter password to enable editing controls).
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);

  const handleUnauthorized = useCallback(
    (err: unknown) => {
      if (err instanceof UnauthorizedError) {
        onLogout();
        return true;
      }
      return false;
    },
    [onLogout],
  );

  const load = useCallback(async () => {
    try {
      const data = await api.listSites();
      setSites(data);
    } catch (err) {
      if (!handleUnauthorized(err)) {
        toast(err instanceof Error ? err.message : "加载失败", "error");
      }
    } finally {
      setLoading(false);
    }
  }, [handleUnauthorized, toast]);

  // Auto-refresh balances on first load (login), then reload list.
  const refreshBalances = useCallback(
    async (silent = false) => {
      setRefreshing(true);
      try {
        await api.refreshBalance();
        await load();
        if (!silent) toast("余额已刷新", "success");
      } catch (err) {
        if (!handleUnauthorized(err)) {
          toast(err instanceof Error ? err.message : "刷新余额失败", "error");
        }
      } finally {
        setRefreshing(false);
      }
    },
    [handleUnauthorized, load, toast],
  );

  useEffect(() => {
    (async () => {
      await load();
      // Auto balance refresh on entry (only if there are keys).
      await refreshBalances(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Balance is a site-level property (one site = one account); a site's keys
  // just expose different models. So the total sums per-site balances, never
  // per-key — otherwise a site with N keys would count its balance N times.
  const totalBalance = useMemo(() => {
    let sum = 0;
    let any = false;
    for (const site of sites) {
      const bal = siteBalance(site);
      if (bal != null) {
        sum += bal;
        any = true;
      }
    }
    return any ? sum : null;
  }, [sites]);

  const stats = useMemo(() => {
    let keys = 0;
    let alive = 0;
    for (const site of sites) {
      for (const k of site.keys) {
        keys++;
        if (k.status?.alive === 1) alive++;
      }
    }
    return { sites: sites.length, keys, alive };
  }, [sites]);

  // ---- test actions ----
  async function testKey(key: ApiKey) {
    setTestingKeys((prev) => new Set(prev).add(key.id));
    try {
      await api.testKey(key.id);
      await load();
    } catch (err) {
      if (!handleUnauthorized(err)) toast(err instanceof Error ? err.message : "测活失败", "error");
    } finally {
      setTestingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key.id);
        return next;
      });
    }
  }

  async function testSite(site: Site) {
    setTestingSites((prev) => new Set(prev).add(site.id));
    try {
      await api.testSite(site.id);
      await load();
      toast(`「${site.name}」测活完成`, "success");
    } catch (err) {
      if (!handleUnauthorized(err)) toast(err instanceof Error ? err.message : "测活失败", "error");
    } finally {
      setTestingSites((prev) => {
        const next = new Set(prev);
        next.delete(site.id);
        return next;
      });
    }
  }

  // ---- CRUD ----
  async function saveSite(data: { name: string; base_url: string; kind: SiteKind; note: string; access_token: string }) {
    if (siteModal.site) await api.updateSite(siteModal.site.id, data);
    else await api.createSite(data);
    await load();
    toast(siteModal.site ? "网站已更新" : "网站已添加", "success");
  }

  async function deleteSite(site: Site) {
    if (!confirm(`确认删除网站「${site.name}」及其下所有 Key？此操作不可恢复。`)) return;
    try {
      await api.deleteSite(site.id);
      await load();
      toast("网站已删除", "success");
    } catch (err) {
      if (!handleUnauthorized(err)) toast(err instanceof Error ? err.message : "删除失败", "error");
    }
  }

  async function saveKey(siteId: number, keyId: number | null, data: { label: string; group_name: string; api_key: string }) {
    if (keyId) await api.updateKey(keyId, data);
    else await api.createKey({ site_id: siteId, ...data });
    await load();
    toast(keyId ? "Key 已更新" : "Key 已添加", "success");
  }

  async function deleteKey(key: ApiKey) {
    if (!confirm("确认删除该 Key？")) return;
    try {
      await api.deleteKey(key.id);
      await load();
      toast("Key 已删除", "success");
    } catch (err) {
      if (!handleUnauthorized(err)) toast(err instanceof Error ? err.message : "删除失败", "error");
    }
  }

  async function logout() {
    try {
      await api.logout();
    } finally {
      onLogout();
    }
  }

  function openUnlock() {
    setUnlockPassword("");
    setUnlockError(null);
    setUnlockOpen(true);
  }

  async function submitUnlock(e: FormEvent) {
    e.preventDefault();
    setUnlockError(null);
    setUnlocking(true);
    try {
      await api.unlock(unlockPassword);
      onEditChange(true);
      setUnlockOpen(false);
      setUnlockPassword("");
      toast("已进入编辑模式", "success");
    } catch (err) {
      if (!handleUnauthorized(err)) {
        setUnlockError(err instanceof Error ? err.message : "解锁失败");
      }
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
      if (!handleUnauthorized(err)) toast(err instanceof Error ? err.message : "操作失败", "error");
    }
  }

  return (
    <div className="relative min-h-screen">
      {/* ambient animated background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        {/* slow-rotating aurora sweep */}
        <div className="absolute left-1/2 top-1/2 h-[120vmax] w-[120vmax] -translate-x-1/2 -translate-y-1/2 animate-spin-slow opacity-[0.18] blur-[80px]"
          style={{
            backgroundImage:
              "conic-gradient(from 0deg, transparent 0deg, rgba(91,124,255,0.5) 60deg, transparent 130deg, rgba(168,85,247,0.5) 200deg, transparent 260deg, rgba(34,211,238,0.45) 320deg, transparent 360deg)",
          }}
        />
        {/* drifting orbs */}
        <div className="absolute -left-32 -top-40 h-96 w-96 animate-drift rounded-full bg-brand-600/20 blur-3xl" />
        <div className="absolute -right-24 top-1/4 h-[26rem] w-[26rem] animate-drift rounded-full bg-accent-violet/15 blur-3xl [animation-duration:22s]" />
        <div className="absolute bottom-0 left-1/3 h-80 w-80 animate-drift rounded-full bg-accent-cyan/12 blur-3xl [animation-duration:16s]" />
        <div className="absolute right-1/4 top-10 h-64 w-64 animate-pulse-glow rounded-full bg-brand-500/10 blur-3xl" />
        {/* faint top vignette to keep header text crisp */}
        <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-ink-950/80 to-transparent" />
      </div>

      <div className="relative mx-auto max-w-[1100px] px-4 py-6 sm:px-6">
      {/* header */}
      <header className="mb-6 animate-fade-in">
        <div className="card relative overflow-hidden p-5">
          {/* top accent line */}
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-500/60 to-transparent" />
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="relative">
                <div className="absolute inset-0 animate-pulse-glow rounded-2xl bg-brand-grad blur-lg opacity-50" />
                <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-grad shadow-glow">
                  <ShieldCheck className="text-white" size={24} />
                </div>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold tracking-tight text-gradient">中转站监控平台</h1>
                  <span
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ${
                      editMode
                        ? "bg-brand-500/10 text-brand-300 ring-brand-500/30"
                        : "bg-white/5 text-slate-300 ring-white/10"
                    }`}
                  >
                    {editMode ? <LockOpen size={12} /> : <Eye size={12} />}
                    {editMode ? "编辑模式" : "查看模式"}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-500">集中监控中转站可用性、倍率与余额</p>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <button onClick={() => refreshBalances(false)} disabled={refreshing} className="btn-ghost">
                <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
                刷新余额
              </button>
              {editMode && (
                <button onClick={() => setSiteModal({ open: true, site: null })} className="btn-primary">
                  <Plus size={16} />
                  添加网站
                </button>
              )}
              {editMode ? (
                <button onClick={exitEdit} className="btn-ghost" title="退出编辑模式">
                  <Lock size={16} />
                  退出编辑
                </button>
              ) : (
                <button onClick={openUnlock} className="btn-ghost" title="解锁编辑模式">
                  <Pencil size={16} />
                  编辑
                </button>
              )}
              <button onClick={logout} className="btn-ghost !px-2.5" title="退出登录">
                <LogOut size={16} />
              </button>
            </div>
          </div>

          {/* stat tiles */}
          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile icon={Globe} label="网站" value={String(stats.sites)} tone="brand" />
            <StatTile icon={KeyRound} label="Key 总数" value={String(stats.keys)} tone="slate" />
            <StatTile icon={Activity} label="可用" value={`${stats.alive} / ${stats.keys}`} tone="emerald" />
            <StatTile icon={Wallet} label="总余额" value={formatUsd(totalBalance)} tone="emerald" mono />
          </div>
        </div>
      </header>

      {/* content */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-500">
          <Activity className="mr-2 animate-pulse" size={18} />
          加载中...
        </div>
      ) : sites.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600/15 ring-1 ring-brand-500/30">
            <Plus className="text-brand-400" size={22} />
          </div>
          <p className="text-slate-300">还没有添加任何中转站</p>
          {editMode ? (
            <>
              <p className="text-sm text-slate-500">点击「添加网站」开始监控你的第一个中转站</p>
              <button onClick={() => setSiteModal({ open: true, site: null })} className="btn-primary mt-2">
                <Plus size={15} />
                添加网站
              </button>
            </>
          ) : (
            <p className="text-sm text-slate-500">点击右上角「编辑」解锁后即可添加中转站</p>
          )}
        </div>
      ) : (
        // One site per row (full width); keys inside each card use a 2-col grid.
        <div className="space-y-4">
          {sites.map((site, i) => (
            <div
              key={site.id}
              className="animate-fade-in"
              style={{ animationDelay: `${Math.min(i * 60, 360)}ms`, animationFillMode: "backwards" }}
            >
              <SiteCard
                site={site}
                editMode={editMode}
                testingKeys={testingKeys}
                testingSite={testingSites.has(site.id)}
                onTestSite={() => testSite(site)}
                onTestKey={(k) => testKey(k)}
                onAddKey={() => setKeyModal({ open: true, siteId: site.id, key: null })}
                onEditKey={(k) => setKeyModal({ open: true, siteId: site.id, key: k })}
                onDeleteKey={(k) => deleteKey(k)}
                onEditSite={() => setSiteModal({ open: true, site })}
                onDeleteSite={() => deleteSite(site)}
              />
            </div>
          ))}
        </div>
      )}

      {/* modals */}
      {siteModal.open && (
        <SiteFormModal
          site={siteModal.site}
          onClose={() => setSiteModal({ open: false, site: null })}
          onSubmit={saveSite}
        />
      )}
      {keyModal?.open && (
        <KeyFormModal
          apiKey={keyModal.key}
          onClose={() => setKeyModal(null)}
          onSubmit={(data) => saveKey(keyModal.siteId, keyModal.key?.id ?? null, data)}
        />
      )}
      {unlockOpen && (
        <Modal title="解锁编辑模式" onClose={() => setUnlockOpen(false)}>
          <form onSubmit={submitUnlock} className="space-y-4">
            <p className="text-sm text-slate-400">再次输入登录密码以启用增删改功能。</p>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">密码</label>
              <div className="relative">
                <KeyRound size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="password"
                  autoFocus
                  autoComplete="current-password"
                  value={unlockPassword}
                  onChange={(e) => setUnlockPassword(e.target.value)}
                  placeholder="••••••••"
                  className="input pl-9"
                />
              </div>
            </div>
            {unlockError && (
              <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{unlockError}</p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setUnlockOpen(false)} className="btn-ghost">
                取消
              </button>
              <button type="submit" disabled={unlocking || !unlockPassword} className="btn-primary">
                {unlocking ? <Loader2 size={16} className="animate-spin" /> : <LockOpen size={16} />}
                {unlocking ? "解锁中..." : "解锁"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      </div>
    </div>
  );
}

const STAT_TONES = {
  brand: { icon: "text-brand-400", ring: "ring-brand-500/25", glow: "bg-brand-500/10", value: "text-brand-200" },
  emerald: { icon: "text-emerald-400", ring: "ring-emerald-500/25", glow: "bg-emerald-500/10", value: "text-emerald-300" },
  slate: { icon: "text-slate-300", ring: "ring-white/10", glow: "bg-white/[0.04]", value: "text-slate-100" },
} as const;

function StatTile({
  icon: Icon,
  label,
  value,
  tone,
  mono,
}: {
  icon: typeof Globe;
  label: string;
  value: string;
  tone: keyof typeof STAT_TONES;
  mono?: boolean;
}) {
  const t = STAT_TONES[tone];
  return (
    <div className={`group relative overflow-hidden rounded-xl border border-white/[0.06] bg-ink-900/40 px-4 py-3 ring-1 ${t.ring} transition-all duration-300 hover:border-white/15 hover:bg-ink-900/70`}>
      <div className={`absolute -right-6 -top-6 h-16 w-16 rounded-full ${t.glow} blur-2xl transition-opacity duration-300 group-hover:opacity-80`} />
      <div className="relative flex items-center gap-3">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${t.glow} ring-1 ${t.ring}`}>
          <Icon size={17} className={t.icon} />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-slate-500">{label}</p>
          <p className={`mt-0.5 truncate text-lg font-bold ${t.value} ${mono ? "font-mono" : ""}`}>{value}</p>
        </div>
      </div>
    </div>
  );
}
