import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
const appOrigin = new URL(
  process.env.CALIO_PUBLIC_ORIGIN ?? "http://127.0.0.1:4173",
).origin;
const host = "127.0.0.1";
const port = Number(process.env.CALIO_PORT ?? "4173");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};
const security = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy":
    "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob:; connect-src 'self' https:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; worker-src 'self' blob:",
};

const server = createServer(
  { requestTimeout: 35_000, headersTimeout: 10_000 },
  async (request, outgoing) => {
    const method = request.method ?? "GET";
    try {
      const url = new URL(request.url ?? "/", appOrigin);
      if (url.origin !== appOrigin) {
        outgoing.writeHead(400, security).end();
        return;
      }
      if (
        /^\/api(?:\/|$)/.test(url.pathname) ||
        (method !== "GET" && method !== "HEAD")
      ) {
        outgoing.writeHead(404, security).end();
        return;
      }
      const pathname = decodeURIComponent(url.pathname);
      const candidate = resolve(root, `.${pathname}`);
      if (candidate !== root && !candidate.startsWith(root + sep)) {
        outgoing.writeHead(404, security).end();
        return;
      }
      const file =
        pathname === "/" || !extname(candidate)
          ? resolve(root, "index.html")
          : candidate;
      const data = await readFile(file).catch(() => null);
      if (!data) {
        outgoing.writeHead(404, security).end();
        return;
      }
      const type = contentTypes[extname(file)] ?? "application/octet-stream";
      // Stable cache names and the service worker always revalidate. The SW handles offline use.
      const cacheControl = /-[A-Za-z0-9_-]{8}\.(?:css|js|woff2|webp)$/.test(
        file,
      )
        ? "public, max-age=31536000, immutable"
        : "no-cache";
      outgoing.writeHead(200, {
        ...security,
        "Content-Type": type,
        "Content-Length": data.length,
        "Cache-Control": cacheControl,
      });
      outgoing.end(method === "HEAD" ? undefined : data);
    } catch {
      outgoing.writeHead(400, security).end();
    }
  },
);

server.listen(port, host, () => {
  console.log(`Calio listening on http://${host}:${port}`);
});
