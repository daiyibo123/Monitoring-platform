import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Frontend builds to ./dist which Cloudflare Pages serves as static assets.
// The /functions directory is deployed as Pages Functions automatically.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: false,
  },
  server: {
    // Local `vite dev` proxies API calls to `wrangler pages dev` on :8788.
    proxy: {
      "/api": "http://127.0.0.1:8788",
    },
  },
});
