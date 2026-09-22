/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#070810",
          900: "#0c0e18",
          850: "#11131f",
          800: "#171a29",
          700: "#212537",
          600: "#2c3248",
        },
        brand: {
          300: "#a9baff",
          400: "#8098ff",
          500: "#5b7cff",
          600: "#4361ee",
          700: "#3550d0",
        },
        accent: {
          cyan: "#22d3ee",
          violet: "#a855f7",
          pink: "#ec4899",
        },
      },
      // Bumped one step up from Tailwind defaults — the UI read too small.
      fontSize: {
        xs: ["0.8125rem", { lineHeight: "1.1rem" }], // 13px
        sm: ["0.9375rem", { lineHeight: "1.35rem" }], // 15px
        base: ["1.0625rem", { lineHeight: "1.6rem" }], // 17px
        lg: ["1.1875rem", { lineHeight: "1.75rem" }], // 19px
        xl: ["1.375rem", { lineHeight: "1.85rem" }], // 22px
        "2xl": ["1.625rem", { lineHeight: "2rem" }], // 26px
        "3xl": ["2.125rem", { lineHeight: "2.4rem" }], // 34px
      },
      fontFamily: {
        sans: [
          "Inter",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "PingFang SC",
          "Microsoft YaHei",
          "sans-serif",
        ],
        mono: ["JetBrains Mono", "Consolas", "Monaco", "monospace"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(91,124,255,0.14), 0 16px 56px -18px rgba(91,124,255,0.5)",
        card: "0 1px 0 0 rgba(255,255,255,0.05) inset, 0 12px 40px -24px rgba(0,0,0,0.9)",
        "glow-emerald": "0 0 0 1px rgba(16,185,129,0.18), 0 12px 40px -16px rgba(16,185,129,0.4)",
      },
      backgroundImage: {
        "brand-grad": "linear-gradient(135deg, #8098ff 0%, #a855f7 55%, #22d3ee 120%)",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-glow": {
          "0%, 100%": { opacity: "0.5", transform: "scale(1)" },
          "50%": { opacity: "1", transform: "scale(1.08)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
        // Large, slow diagonal drift for background orbs — more organic than float.
        drift: {
          "0%, 100%": { transform: "translate(0, 0) scale(1)" },
          "33%": { transform: "translate(40px, -30px) scale(1.08)" },
          "66%": { transform: "translate(-30px, 25px) scale(0.95)" },
        },
        // Very slow rotation for the aurora sweep behind everything.
        "spin-slow": {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.2s ease-out",
        "pulse-glow": "pulse-glow 3.5s ease-in-out infinite",
        float: "float 6s ease-in-out infinite",
        shimmer: "shimmer 8s linear infinite",
        drift: "drift 18s ease-in-out infinite",
        "spin-slow": "spin-slow 40s linear infinite",
      },
    },
  },
  plugins: [],
};
