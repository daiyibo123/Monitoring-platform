import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CheckCircle2, Info, XCircle } from "lucide-react";

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

const TONE: Record<ToastKind, { icon: typeof Info; color: string; bar: string }> = {
  success: { icon: CheckCircle2, color: "text-emerald-400", bar: "bg-emerald-400" },
  error: { icon: XCircle, color: "text-rose-400", bar: "bg-rose-400" },
  info: { icon: Info, color: "text-primary-300", bar: "bg-primary-400" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((message: string, kind: ToastKind = "info") => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev.slice(-3), { id, kind, message }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), kind === "error" ? 5200 : 3400);
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-[min(92vw,380px)] flex-col gap-2" role="status" aria-live="polite">
        {items.map((t) => {
          const tone = TONE[t.kind];
          const Icon = tone.icon;
          return (
            <div
              key={t.id}
              className="glass pointer-events-auto relative flex animate-slide-up items-start gap-2.5 overflow-hidden rounded-xl py-3 pl-4 pr-4 text-sm"
            >
              <span className={`absolute inset-y-0 left-0 w-1 ${tone.bar}`} />
              <Icon size={17} className={`mt-px shrink-0 ${tone.color}`} />
              <span className="break-words text-dark-100">{t.message}</span>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}
