import { useState, type FormEvent, type ReactNode } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import type { ApiKey, KeyInput } from "../types";
import { Modal } from "./Modal";

export function KeyFormModal({
  apiKey,
  onClose,
  onSubmit,
}: {
  apiKey: ApiKey | null;
  onClose: () => void;
  onSubmit: (data: KeyInput) => Promise<void>;
}) {
  const [label, setLabel] = useState(apiKey?.label ?? "");
  const [groupName, setGroupName] = useState(apiKey?.group_name ?? "");
  const [key, setKey] = useState("");
  const [probeModel, setProbeModel] = useState(apiKey?.probe_model ?? "");
  const [saving, setSaving] = useState(false);
  const knownModels = apiKey?.status?.models ?? [];
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!apiKey && !key.trim()) {
      setError("请填写 API Key");
      return;
    }
    setSaving(true);
    try {
      const data: KeyInput = { label: label.trim(), group_name: groupName.trim(), probe_model: probeModel.trim() };
      if (key.trim()) data.api_key = key.trim();
      await onSubmit(data);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
      setSaving(false);
    }
  }

  return (
    <Modal title={apiKey ? "编辑 Key / 分组" : "添加 Key / 分组"} icon={<KeyRound size={18} />} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="显示名称（可选）">
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="例如：GPT 分组 / Claude 高速" autoFocus />
        </Field>
        <Field label="上游分组标识（可选，用于匹配分组倍率）">
          <input className="input font-mono" value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="例如：default / vip（留空取默认分组）" />
        </Field>
        <Field label="API Key">
          <textarea
            className="input min-h-[76px] resize-y font-mono"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={apiKey ? `留空保持不变（当前 ${apiKey.key_masked}）` : "sk-..."}
            autoComplete="off"
            spellCheck={false}
          />
          {!apiKey && <p className="mt-1 text-xs text-dark-400">保存后会自动测活一次。</p>}
        </Field>
        <Field label="测活模型（可选）">
          <input
            className="input font-mono"
            value={probeModel}
            onChange={(e) => setProbeModel(e.target.value)}
            placeholder="填你实际在用的模型，例如 claude-sonnet-4-5；留空自动选择"
            list="probe-model-options"
            autoComplete="off"
            spellCheck={false}
          />
          {knownModels.length > 0 && (
            <datalist id="probe-model-options">
              {knownModels.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          )}
          <p className="mt-1 text-xs text-dark-400">测活优先用这个模型发真实请求；它失败时仍会自动尝试其他模型。</p>
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
