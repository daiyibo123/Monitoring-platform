import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { useToast } from "./Toast";

export function CopyButton({
  value,
  label,
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();

  async function onCopy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      toast(`${label || "内容"}已复制`, "success");
      setTimeout(() => setCopied(false), 1400);
    } catch {
      toast("复制失败", "error");
    }
  }

  return (
    <button
      type="button"
      onClick={onCopy}
      title={`复制${label || ""}`}
      className={
        className ||
        "inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs text-slate-300 transition-colors hover:bg-white/5"
      }
    >
      {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
      {label && <span>{copied ? "已复制" : "复制"}</span>}
    </button>
  );
}
