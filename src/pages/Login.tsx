import { useState, type FormEvent } from "react";
import {
  Activity,
  AlertTriangle,
  KeyRound,
  Layers,
  Loader2,
  ShieldCheck,
  User,
  Wallet,
  Zap,
} from "lucide-react";
import { api } from "../api";

const FEATURES = [
  { icon: Activity, title: "可用性监控", desc: "一键测活，实时掌握每个 Key 的连通状态" },
  { icon: Layers, title: "分组倍率", desc: "按渠道分组展示模型倍率与计费方式" },
  { icon: Wallet, title: "账户余额", desc: "网站级余额聚合，总额一眼可见" },
  { icon: Zap, title: "一键测活", desc: "单 Key 或整站批量测试，秒级反馈" },
];

export function Login({
  configured,
  onSuccess,
}: {
  configured: boolean;
  onSuccess: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.login(username.trim() || "admin", password);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* animated background orbs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-24 -top-24 h-96 w-96 animate-pulse-glow rounded-full bg-brand-600/25 blur-3xl" />
        <div className="absolute -bottom-32 -right-16 h-[28rem] w-[28rem] animate-float rounded-full bg-accent-violet/20 blur-3xl" />
        <div className="absolute left-1/2 top-1/3 h-72 w-72 animate-float rounded-full bg-accent-cyan/15 blur-3xl [animation-duration:9s]" />
      </div>

      <div className="relative mx-auto grid min-h-screen max-w-6xl items-center gap-12 px-6 py-10 lg:grid-cols-2">
        {/* brand / features */}
        <div className="animate-fade-in text-center lg:text-left">
          <div className="mb-6 flex justify-center lg:justify-start">
            <div className="relative">
              <div className="absolute inset-0 animate-pulse-glow rounded-2xl bg-brand-grad blur-xl opacity-60" />
              <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-grad shadow-glow">
                <ShieldCheck className="text-white" size={32} />
              </div>
            </div>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-gradient">中转站监控平台</h1>
          <p className="mt-3 max-w-md text-sm text-slate-400 lg:text-base">
            集中监控你的 API 中转站 —— 连通性、模型倍率与账户余额，一屏尽览。
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="flex items-start gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3 text-left"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600/15 ring-1 ring-brand-500/25">
                  <f.icon size={17} className="text-brand-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-200">{f.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* login card */}
        <div className="animate-fade-in mx-auto w-full max-w-sm [animation-delay:80ms]">
          {!configured && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <span>
                服务器尚未配置 <code className="font-mono">APP_PASSWORD</code> /{" "}
                <code className="font-mono">SESSION_SECRET</code>，请先在 Cloudflare 或{" "}
                <code className="font-mono">.dev.vars</code> 中设置。
              </span>
            </div>
          )}

          <form onSubmit={onSubmit} className="card space-y-4 p-6 shadow-glow">
            <div className="mb-1">
              <h2 className="text-lg font-semibold text-white">登录</h2>
              <p className="mt-1 text-xs text-slate-500">登录后默认为查看模式，编辑需再次验证密码</p>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">用户名</label>
              <div className="relative">
                <User size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  autoFocus
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  className="input pl-9"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-400">密码</label>
              <div className="relative">
                <KeyRound size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="input pl-9"
                />
              </div>
            </div>

            {error && (
              <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>
            )}

            <button type="submit" disabled={loading || !password} className="btn-primary w-full py-2.5">
              {loading && <Loader2 size={16} className="animate-spin" />}
              {loading ? "登录中..." : "登录"}
            </button>

            <p className="text-center text-xs text-slate-600">
              会话通过 HttpOnly Cookie 保存 · 单账号 + 密码解锁编辑
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
