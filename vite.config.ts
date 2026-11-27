import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { createAiHttp, isAiPath } from "./server/ai-http";
import { openAiSettings } from "./server/ai-settings";

function localAiGateway(): Plugin {
  return {
    name: "calio-local-ai",
    apply: "serve",
    async configureServer(server) {
      const aiSettings = await openAiSettings(
        resolve(server.config.root, ".calio-ai.json.dev"),
        { apiKey: "", enabled: false },
      );
      const handlers = new Map<string, ReturnType<typeof createAiHttp>>();
      server.middlewares.use((request, response, next) => {
        const path = (request.url ?? "").split("?", 1)[0] ?? "";
        if (!isAiPath(path)) return next();
        const { host } = request.headers;
        const { localPort, remoteAddress } = request.socket;
        if (
          !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
            remoteAddress ?? "",
          ) ||
          (host !== `localhost:${localPort}` &&
            host !== `127.0.0.1:${localPort}`)
        ) {
          response.writeHead(403, { "Cache-Control": "no-store" }).end();
          return;
        }
        const appOrigin = `http://${host}`;
        let handler = handlers.get(appOrigin);
        if (!handler) {
          handler = createAiHttp({ appOrigin, aiSettings });
          handlers.set(appOrigin, handler);
        }
        void handler
          .respond(request, response, new URL(path, appOrigin))
          .catch(next);
      });
    },
  };
}

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
    localAiGateway(),
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
