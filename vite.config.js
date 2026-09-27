import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// The icon and text font packages list woff, ttf and svg fallbacks after woff2; the webview only ever loads woff2,
// so the rest (~4 MB, mostly Phosphor's svg font) would just ride along in the binary.
const woff2Only = {
  name: "woff2-only",
  enforce: "pre",
  transform: (code, id) => (/node_modules.*\.css$/.test(id) ? code.replace(/,\s*url\(["']?[^)"']+\.(?:woff|ttf|svg(?:#[^)"']*)?)["']?\)\s*format\([^)]*\)/g, "") : null),
};

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [woff2Only, react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
