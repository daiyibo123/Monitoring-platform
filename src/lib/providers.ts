// Detect which upstream vendor(s) a key exposes, inferred from the accessible
// model ids returned by 测活 (relay sk- keys are opaque, so model names are the
// only reliable signal). Used to tag key rows and to build a site's 渠道 chips.

export type ProviderId =
  | "openai"
  | "claude"
  | "gemini"
  | "grok"
  | "glm"
  | "deepseek"
  | "qwen"
  | "kimi"
  | "other";

export interface ProviderMeta {
  id: ProviderId;
  label: string;
  // Tailwind classes for the badge (text + subtle bg + ring), tuned for dark UI.
  badge: string;
}

export const PROVIDERS: Record<ProviderId, ProviderMeta> = {
  openai: { id: "openai", label: "GPT", badge: "text-emerald-300 bg-emerald-500/10 ring-emerald-500/30" },
  claude: { id: "claude", label: "Claude", badge: "text-orange-300 bg-orange-500/10 ring-orange-500/30" },
  gemini: { id: "gemini", label: "Gemini", badge: "text-sky-300 bg-sky-500/10 ring-sky-500/30" },
  grok: { id: "grok", label: "Grok", badge: "text-slate-200 bg-white/10 ring-white/20" },
  glm: { id: "glm", label: "GLM", badge: "text-indigo-300 bg-indigo-500/10 ring-indigo-500/30" },
  deepseek: { id: "deepseek", label: "DeepSeek", badge: "text-blue-300 bg-blue-500/10 ring-blue-500/30" },
  qwen: { id: "qwen", label: "Qwen", badge: "text-violet-300 bg-violet-500/10 ring-violet-500/30" },
  kimi: { id: "kimi", label: "Kimi", badge: "text-fuchsia-300 bg-fuchsia-500/10 ring-fuchsia-500/30" },
  other: { id: "other", label: "其它", badge: "text-slate-300 bg-white/5 ring-white/10" },
};

// Ordered longest/most-specific first so e.g. "text-embedding" wins before we'd
// ever fall through. Each entry: substrings that map a model id to a provider.
const RULES: Array<{ id: ProviderId; match: (m: string) => boolean }> = [
  { id: "claude", match: (m) => m.includes("claude") || m.includes("anthropic") },
  { id: "grok", match: (m) => m.startsWith("grok") || m.includes("grok") },
  { id: "glm", match: (m) => m.includes("glm") || m.includes("chatglm") || m.includes("cogview") || m.includes("cogvideo") },
  { id: "gemini", match: (m) => m.includes("gemini") || m.startsWith("models/gemini") || m.includes("imagen") },
  { id: "deepseek", match: (m) => m.includes("deepseek") },
  { id: "qwen", match: (m) => m.startsWith("qwen") || m.includes("qwen") || m.startsWith("qwq") },
  { id: "kimi", match: (m) => m.includes("moonshot") || m.includes("kimi") },
  {
    id: "openai",
    match: (m) =>
      m.startsWith("gpt") ||
      m.startsWith("o1") ||
      m.startsWith("o3") ||
      m.startsWith("o4") ||
      m.startsWith("chatgpt") ||
      m.includes("dall-e") ||
      m.startsWith("whisper") ||
      m.startsWith("tts") ||
      m.includes("text-embedding") ||
      m.includes("omni-moderation"),
  },
];

function classify(model: string): ProviderId {
  const m = model.toLowerCase().trim();
  for (const rule of RULES) {
    if (rule.match(m)) return rule.id;
  }
  return "other";
}

export interface DetectResult {
  // Distinct providers present, ordered by model count (desc).
  providers: ProviderId[];
  // The single most-represented provider (the "家" this key mostly is).
  primary: ProviderId | null;
}

export function detectProviders(models: string[] | null | undefined): DetectResult {
  if (!models || models.length === 0) return { providers: [], primary: null };
  const counts = new Map<ProviderId, number>();
  for (const model of models) {
    const id = classify(model);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  // Prefer a real vendor over the "other" bucket for the primary label.
  const primary = ordered.find((id) => id !== "other") ?? ordered[0] ?? null;
  return { providers: ordered, primary };
}
