// Copy text that may still be loading. A promise-backed ClipboardItem keeps the
// user gesture alive while the value is fetched (Safari needs this); otherwise
// fall back to writeText, then to a hidden textarea.
export async function copyText(value: string | Promise<string>): Promise<void> {
  const ClipItem = (window as any).ClipboardItem as typeof ClipboardItem | undefined;
  if (typeof value !== "string" && ClipItem && navigator.clipboard?.write) {
    try {
      const blob = Promise.resolve(value).then((t) => new Blob([t], { type: "text/plain" }));
      await navigator.clipboard.write([new ClipItem({ "text/plain": blob })]);
      return;
    } catch {
      // Not supported here: resolve first and use the plain path.
    }
  }
  const text = await value;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Permission/focus issue: try the legacy path.
    }
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(ta);
  if (!ok) throw new Error("copy failed");
}
