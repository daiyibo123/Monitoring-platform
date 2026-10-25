import { useEffect, useId, type ReactNode } from "react";
import { X } from "lucide-react";

export function Modal({
  title,
  icon,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const titleId = useId();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-950/70 p-4 backdrop-blur-md animate-fade-in" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative w-full ${wide ? "max-w-xl" : "max-w-md"} animate-scale-in rounded-2xl bg-gradient-to-b from-primary-400/30 via-white/[0.06] to-white/[0.02] p-px shadow-glow-lg`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="max-h-[88vh] overflow-y-auto rounded-2xl bg-dark-900/95 p-5 backdrop-blur-xl scrollbar-thin sm:p-6">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              {icon && (
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-500/15 text-primary-300 ring-1 ring-primary-400/25">{icon}</span>
              )}
              <h3 id={titleId} className="text-base font-semibold text-white">
                {title}
              </h3>
            </div>
            <button onClick={onClose} className="icon-btn" aria-label="关闭">
              <X size={18} />
            </button>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
