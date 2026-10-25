import { useState, type FormEvent } from "react";
import { Activity, AlertTriangle, CalendarCheck, KeyRound, Layers, Loader2, LogIn, ShieldCheck, User, Wallet } from "lucide-react";
import { api } from "../api";
import { Backdrop, BrandMark } from "../components/Backdrop";

const FEATURES = [
  { icon: Activity, title: "真实请求测活", desc: "最便宜模型发一次真实请求，只有真正返回补全才算可用" },
  { icon: Layers, title: "分组倍率", desc: "New-API / sub2api 分组倍率与模型倍率一目了然" },
  { icon: Wallet, title: "账户余额", desc: "网站级余额，可用在前、余额从高到低排序" },
  { icon: CalendarCheck, title: "每日自动测活", desc: "每天首次打开自动测一遍，多设备不重复" },
];

export function Login({ configured, onSuccess }: { configured: boolean; onSuccess: () => void }) {
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
      <Backdrop />
      <div className="relative z-10 mx-auto grid min-h-screen max-w-6xl items-center gap-12 px-6 py-10 lg:grid-cols-[1.1fr_1fr]">
        <section className="animate-slide-up text-center lg:text-left">
          <div className="mb-7 flex justify-center lg:justify-start">
            <BrandMark size={64} />
          </div>
          <span className="chip mb-4 bg-primary-500/10 text-primary-200 ring-primary-400/30">
            <ShieldCheck size={12} />
            Relay Monitor
          </span>
          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            中转站<span className="text-gradient">监控平台</span>
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-dark-400 lg:mx-0 lg:text-base">集中监控你的 AI API 中转站：真实可用性、分组倍率与账户余额，一屏掌握。</p>
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                className="glass card-hover flex animate-slide-up items-start gap-3 rounded-xl px-4 py-3 text-left"
                style={{ animationDelay: `${120 + i * 70}ms`, animationFillMode: "backwards" }}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-500/10 text-primary-300 ring-1 ring-primary-400/25">
                  <f.icon size={17} />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-dark-100">{f.title}</span>
                  <span className="mt-0.5 block text-xs leading-snug text-dark-500">{f.desc}</span>
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto w-full max-w-sm animate-scale-in">
          {!configured && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <span>
                服务器尚未配置 <code className="font-mono">APP_PASSWORD</code> / <code className="font-mono">SESSION_SECRET</code>，请先在 Cloudflare 或{" "}
                <code className="font-mono">.dev.vars</code> 中设置。
              </span>
            </div>
          )}
          <div className="rounded-2xl bg-gradient-to-b from-primary-400/35 via-white/[0.06] to-white/[0.02] p-px shadow-glow-lg">
            <form onSubmit={onSubmit} className="space-y-4 rounded-2xl bg-dark-900/90 p-6 backdrop-blur-xl">
              <div>
                <h2 className="text-lg font-semibold text-white">欢迎回来</h2>
                <p className="mt-1 text-xs text-dark-500">登录后默认为查看模式，编辑需再次验证密码</p>
              </div>
              <label className="block">
                <span className="label">用户名</span>
                <span className="relative block">
                  <User size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-dark-500" />
                  <input type="text" autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" className="input pl-9" />
                </span>
              </label>
              <label className="block">
                <span className="label">密码</span>
                <span className="relative block">
                  <KeyRound size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-dark-500" />
                  <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="input pl-9" />
                </span>
              </label>
              {error && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300 ring-1 ring-rose-500/20">{error}</p>}
              <button type="submit" disabled={loading || !password} className="btn-primary w-full py-2.5">
                {loading ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
                {loading ? "登录中..." : "登录"}
              </button>
              <p className="text-center text-[11px] text-dark-600">会话保存在 HttpOnly Cookie · 单账号 + 密码解锁编辑</p>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}
