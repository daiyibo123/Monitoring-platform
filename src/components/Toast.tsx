import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CheckCircle2, XCircle, Info } from "lucide-react";

type ToastKind = "success" | "error" | "info";
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

const ToastCtx = createContext<(message: string, kind?: ToastKind) => void>(() => {});

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((message: string, kind: ToastKind = "info") => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex animate-fade-in items-center gap-2 rounded-xl border border-white/10 bg-ink-800/95 px-4 py-2.5 text-sm shadow-glow backdrop-blur"
          >
            {t.kind === "success" && <CheckCircle2 size={16} className="text-emerald-400" />}
            {t.kind === "error" && <XCircle size={16} className="text-rose-400" />}
            {t.kind === "info" && <Info size={16} className="text-brand-400" />}
            <span className="text-slate-200">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
