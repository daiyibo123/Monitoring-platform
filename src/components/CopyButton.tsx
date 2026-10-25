import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { copyText } from "../lib/clipboard";
import { useToast } from "./Toast";

// `value` may be a loader: secrets are fetched on first copy.
export function CopyButton({
  value,
  label,
  compact = false,
}: {
  value: string | (() => Promise<string>);
  label?: string;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();

  async function onCopy() {
    try {
      await copyText(typeof value === "string" ? value : value());
      setCopied(true);
      toast(`${label || "内容"}已复制`, "success");
      setTimeout(() => setCopied(false), 1400);
    } catch (e) {
      toast(e instanceof Error && e.message !== "copy failed" ? e.message : "复制失败", "error");
    }
  }

  const icon = copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />;
  if (compact) {
    return (
      <button type="button" onClick={onCopy} className="icon-btn h-7 w-7" title={`复制${label || ""}`} aria-label={`复制${label || ""}`}>
        {icon}
      </button>
    );
  }
  return (
    <button type="button" onClick={onCopy} className="btn-secondary btn-sm" title={`复制${label || ""}`}>
      {icon}
      <span>{copied ? "已复制" : `复制${label || ""}`}</span>
    </button>
  );
}
