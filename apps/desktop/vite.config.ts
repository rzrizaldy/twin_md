import { defineConfig } from "vite";
import { resolve } from "node:path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(() => ({
  root: ".",
  publicDir: "public",
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: {
      // Tauri picks up src-tauri changes itself.
      ignored: ["**/src-tauri/**"]
    }
  },
  build: {
    target: ["es2022", "chrome110", "safari15"],
    minify: (!process.env.TAURI_DEBUG ? "esbuild" : false) as "esbuild" | false,
    sourcemap: Boolean(process.env.TAURI_DEBUG),
    rollupOptions: {
      input: {
        companion: resolve(__dirname, "index.html"),
        bubble: resolve(__dirname, "bubble.html"),
        onboarding: resolve(__dirname, "onboarding.html"),
        chat: resolve(__dirname, "chat.html"),
      }
    }
  }
}));
