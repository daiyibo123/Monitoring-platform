import { useState, type FormEvent, type ReactNode } from "react";
import { Globe, Loader2, X } from "lucide-react";
import type { Site, SiteInput, SiteKind } from "../types";
import { Modal } from "./Modal";

const KINDS: Array<{ id: SiteKind; title: string; desc: string }> = [
  { id: "newapi", title: "New-API", desc: "One-API 及衍生，/api/pricing 读倍率" },
  { id: "sub2api", title: "sub2api", desc: "/v1/sub2api/billing 倍率，/v1/usage 余额" },
  { id: "openai", title: "OpenAI 兼容", desc: "只测活 + 余额，不读倍率" },
];

export function SiteFormModal({
  site,
  onClose,
  onSubmit,
}: {
  site: Site | null;
  onClose: () => void;
  onSubmit: (data: SiteInput) => Promise<void>;
}) {
  const [name, setName] = useState(site?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(site?.base_url ?? "");
  const [kind, setKind] = useState<SiteKind>(site?.kind ?? "newapi");
  const [note, setNote] = useState(site?.note ?? "");
  const [token, setToken] = useState("");
  const [clearToken, setClearToken] = useState(false);
  const [userId, setUserId] = useState(site?.newapi_user_id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasToken = Boolean(site?.has_access_token) && !clearToken;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const data: SiteInput = { name: name.trim(), base_url: baseUrl.trim(), kind, note: note.trim(), newapi_user_id: userId.trim() };
      if (token.trim()) data.access_token = token.trim();
      else if (clearToken) data.clear_access_token = true;
      await onSubmit(data);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
      setSaving(false);
    }
  }

  return (
    <Modal title={site ? "编辑网站" : "添加网站"} icon={<Globe size={18} />} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="网站名称">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：某某中转站" autoFocus />
          </Field>
          <Field label="网站地址（Base URL）">
            <input className="input font-mono" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com" />
          </Field>
        </div>

        <Field label="站点类型">
          <div role="radiogroup" aria-label="站点类型" className="grid gap-2 sm:grid-cols-3">
            {KINDS.map((k) => {
              const active = kind === k.id;
              return (
                <button
                  key={k.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setKind(k.id)}
                  className={`rounded-xl border px-3 py-2.5 text-left transition-all ${
                    active ? "border-primary-400/60 bg-primary-500/10 shadow-glow" : "border-dark-600/70 bg-dark-900/60 hover:border-dark-500"
                  }`}
                >
                  <span className={`block text-sm font-semibold ${active ? "text-primary-200" : "text-dark-100"}`}>{k.title}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-dark-400">{k.desc}</span>
                </button>
              );
            })}
          </div>
        </Field>

        {kind === "newapi" && (
          <div className="space-y-3 rounded-xl border border-white/[0.06] bg-dark-950/40 p-3.5">
            <Field label="访问令牌（可选）">
              <div className="flex gap-2">
                <input
                  className="input font-mono"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={hasToken ? "已设置，留空保持不变" : "仅当该站把倍率/余额锁在登录后才需要"}
                  autoComplete="off"
                />
                {hasToken && !token && (
                  <button type="button" onClick={() => setClearToken(true)} className="btn-secondary shrink-0" title="清除已保存的访问令牌">
                    <X size={15} />
                    清除
                  </button>
                )}
              </div>
              {clearToken && <p className="mt-1 text-xs text-amber-300">保存后将清除访问令牌</p>}
            </Field>
            <Field label="用户 ID（可选）">
              <input className="input font-mono" value={userId} onChange={(e) => setUserId(e.target.value.replace(/\D/g, ""))} placeholder="新版 New-API 用访问令牌时需要" inputMode="numeric" />
            </Field>
            <p className="text-xs leading-relaxed text-dark-400">
              部分 New-API 站点的 <code className="text-dark-300">/api/pricing</code> 和余额需登录才能读取，用 sk- key 会 401。在站内「个人设置 → 生成访问令牌」复制填入；新版 New-API 还需填写个人设置里显示的用户 ID。
            </p>
          </div>
        )}

        <Field label="备注（可选）">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="任意备注" />
        </Field>

        {error && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300 ring-1 ring-rose-500/20">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-ghost">
            取消
          </button>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving && <Loader2 size={15} className="animate-spin" />}
            保存
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span className="label">{label}</span>
      {children}
    </div>
  );
}
