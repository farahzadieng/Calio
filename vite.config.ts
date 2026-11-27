import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig({
  server: {
    fs: {
      // Preserve Vite's default exclusions and deny Calio's credential files.
      deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", ".calio-ai.json*"],
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/dexie/")) return "storage";
          if (id.includes("/node_modules/zod/")) return "validation";
        },
      },
    },
  },

  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      injectRegister: false,
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      includeManifestIcons: false,
      manifest: false,
      injectManifest: {
        globPatterns: [
          "**/*.{html,js,css,png,jpg,webp,woff,woff2,ico,svg,webmanifest}",
        ],
      },
    }),
  ],
});
