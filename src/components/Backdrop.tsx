import { Activity } from "lucide-react";

// Ambient background shared by every page: teal mesh, a faint grid, drifting
// glow orbs and a slow aurora sweep. Purely decorative.
export function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="absolute inset-0 bg-mesh-gradient" />
      <div className="grid-bg absolute inset-0" />
      <div
        className="absolute left-1/2 top-1/2 h-[130vmax] w-[130vmax] -translate-x-1/2 -translate-y-1/2 animate-spin-slow opacity-[0.13] blur-[90px]"
        style={{
          backgroundImage:
            "conic-gradient(from 0deg, transparent 0deg, rgba(20,184,166,0.55) 70deg, transparent 140deg, rgba(34,211,238,0.45) 220deg, transparent 280deg, rgba(56,189,248,0.4) 330deg, transparent 360deg)",
        }}
      />
      <div className="absolute -left-40 -top-40 h-[28rem] w-[28rem] animate-drift rounded-full bg-primary-500/15 blur-3xl" />
      <div className="absolute -right-32 top-1/3 h-[24rem] w-[24rem] animate-drift rounded-full bg-cyan-500/10 blur-3xl [animation-delay:-7s] [animation-duration:26s]" />
      <div className="absolute bottom-[-10rem] left-1/3 h-[22rem] w-[22rem] animate-drift rounded-full bg-sky-500/10 blur-3xl [animation-delay:-13s] [animation-duration:32s]" />
      <div className="absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-dark-950/80 to-transparent" />
    </div>
  );
}

// Logo: gradient tile with a pulse line, an orbit ring and a soft glow.
export function BrandMark({ size = 44 }: { size?: number }) {
  const icon = Math.round(size * 0.5);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div className="absolute -inset-1.5 rounded-2xl bg-gradient-brand opacity-40 blur-lg" />
      <div className="absolute -inset-1 animate-spin-slower rounded-[1.1rem] border border-dashed border-primary-300/35" />
      <div className="relative flex h-full w-full items-center justify-center rounded-xl bg-gradient-primary shadow-glow ring-1 ring-white/20">
        <Activity size={icon} strokeWidth={2.4} className="text-white" />
      </div>
    </div>
  );
}
