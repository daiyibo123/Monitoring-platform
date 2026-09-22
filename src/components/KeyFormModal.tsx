import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import type { ApiKey } from "../types";
import { Modal } from "./Modal";

export function KeyFormModal({
  apiKey,
  onClose,
  onSubmit,
}: {
  apiKey: ApiKey | null;
  onClose: () => void;
  onSubmit: (data: { label: string; group_name: string; api_key: string }) => Promise<void>;
}) {
  const [label, setLabel] = useState(apiKey?.label ?? "");
  const [groupName, setGroupName] = useState(apiKey?.group_name ?? "");
  const [key, setKey] = useState(apiKey?.api_key ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await onSubmit({ label: label.trim(), group_name: groupName.trim(), api_key: key.trim() });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
      setSaving(false);
    }
  }

  return (
    <Modal title={apiKey ? "编辑 Key / 分组" : "添加 Key / 分组"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="显示名称（可选）">
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="例如：GPT 分组 / Claude 高速" autoFocus />
        </Field>
        <Field label="上游分组标识（可选，用于匹配分组倍率）">
          <input
            className="input font-mono"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="例如：default / vip（留空则自动取默认分组）"
          />
        </Field>
        <Field label="API Key">
          <textarea
            className="input min-h-[72px] font-mono"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="sk-..."
          />
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
