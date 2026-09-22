import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import type { Site, SiteKind } from "../types";
import { Modal } from "./Modal";

const KIND_LABELS: Record<SiteKind, string> = {
  newapi: "New-API / One-API（/api/pricing 获取倍率）",
  sub2api: "sub2api（/v1/sub2api/billing 获取倍率，/v1/usage 获取余额）",
  openai: "纯 OpenAI 兼容（仅测活/余额，无倍率）",
};

export function SiteFormModal({
  site,
  onClose,
  onSubmit,
}: {
  site: Site | null;
  onClose: () => void;
  onSubmit: (data: { name: string; base_url: string; kind: SiteKind; note: string }) => Promise<void>;
}) {
  const [name, setName] = useState(site?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(site?.base_url ?? "");
  const [kind, setKind] = useState<SiteKind>(site?.kind ?? "newapi");
  const [note, setNote] = useState(site?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await onSubmit({ name: name.trim(), base_url: baseUrl.trim(), kind, note: note.trim() });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
      setSaving(false);
    }
  }

  return (
    <Modal title={site ? "编辑网站" : "添加网站"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="网站名称">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：某某中转站" autoFocus />
        </Field>
        <Field label="网站地址（Base URL）">
          <input
            className="input font-mono"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.example.com"
          />
        </Field>
        <Field label="站点类型">
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as SiteKind)}>
            {(Object.keys(KIND_LABELS) as SiteKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="备注（可选）">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="任意备注" />
        </Field>

        {error && <p className="text-sm text-rose-400">{error}</p>}

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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-slate-400">{label}</label>
      {children}
    </div>
  );
}
