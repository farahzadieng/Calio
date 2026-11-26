import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createGateway } from "./gateway";
import { openAiSettings, readAiSettingsInput } from "./ai-settings";
import { fetchPublicProvider } from "./provider-network";

const appOrigin = new URL(
  process.env.CALIO_PUBLIC_ORIGIN ?? "http://127.0.0.1:4173",
).origin;
const host = "127.0.0.1";
const port = Number(process.env.CALIO_PORT ?? "4173");
const upstreamIdentityToken = process.env.CALIO_AUTH_PROXY_TOKEN ?? "";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");
const appUrl = new URL(appOrigin);
const localOwner =
  !upstreamIdentityToken &&
  appUrl.protocol === "http:" &&
  ["localhost", "127.0.0.1"].includes(appUrl.hostname);
const sessionName = "calio_local_owner";
const localSession = randomBytes(32).toString("hex");
const aiSettings = await openAiSettings(
  process.env.CALIO_AI_CONFIG_FILE || resolve(root, "../.calio-ai.json"),
  {
    apiKey:
      process.env.CALIO_AI_API_KEY || process.env.IRANROUTER_API_KEY || "",
    baseUrl: process.env.CALIO_AI_BASE_URL ?? process.env.IRANROUTER_BASE_URL,
    model: process.env.CALIO_AI_MODEL ?? process.env.IRANROUTER_MODEL,
    calorieModel: process.env.CALIO_AI_CALORIE_MODEL,
    enabled: process.env.CALIO_AI_ENABLED === "true",
  },
);

function matchesSecret(actual: string, expected: string) {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return (
    Boolean(right.length) &&
    left.length === right.length &&
    timingSafeEqual(left, right)
  );
}

function authorized(request: Request) {
  if (upstreamIdentityToken) {
    return matchesSecret(
      request.headers.get("x-calio-authenticated") ?? "",
      upstreamIdentityToken,
    );
  }
  if (!localOwner || request.headers.get("host") !== appUrl.host) return false;
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  const cookie = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(sessionName + "="));
  return matchesSecret(
    cookie?.slice(sessionName.length + 1) ?? "",
    localSession,
  );
}

let currentGateway: ReturnType<typeof createGateway> | undefined;
let boundRevision: string | undefined;
async function handleAi(request: Request) {
  const path = new URL(request.url).pathname;
  const sameOrigin = request.headers.get("Origin") === appOrigin;
  const acceptedHeader = request.headers.get("X-Calio-Request") === "1";
  if (!authorized(request))
    return Response.json({ error: "gateway_auth" }, { status: 403 });

  if (path === "/api/calio/ai/settings") {
    if (!acceptedHeader)
      return Response.json({ error: "gateway_auth" }, { status: 403 });
    if (request.method === "GET")
      return Response.json(aiSettings.publicSettings());
    if (request.method !== "PUT") return new Response(null, { status: 405 });
    if (
      !sameOrigin ||
      !/^application\/json(?:\s*;|$)/i.test(
        request.headers.get("Content-Type") ?? "",
      )
    ) {
      return new Response(null, { status: 403 });
    }
    try {
      return await aiSettings.save(await readAiSettingsInput(request.body));
    } catch {
      return new Response(null, { status: 400 });
    }
  }

  const active = aiSettings.current();
  if (!active.enabled)
    return Response.json({ error: "gateway_unconfigured" }, { status: 503 });
  if (
    !sameOrigin ||
    request.headers.get("X-Calio-Config") !== active.revision
  ) {
    return Response.json(
      { error: "gateway_configuration_changed" },
      { status: 409 },
    );
  }
  if (currentGateway === undefined || boundRevision !== active.revision) {
    currentGateway = createGateway({
      ...active,
      allowedOrigin: appOrigin,
      authenticate: authorized,
      fetchProvider: fetchPublicProvider,
    });
    boundRevision = active.revision;
  }
  return currentGateway(request);
}
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
    "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob:; connect-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self'; worker-src 'self' blob:",
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
      if (["/api/calio/ai", "/api/calio/ai/settings"].includes(url.pathname)) {
        const headers = new Headers();
        for (const [name, value] of Object.entries(request.headers)) {
          if (Array.isArray(value))
            value.forEach((v) => headers.append(name, v));
          else if (value !== undefined) headers.set(name, value);
        }
        const body =
          method === "POST" || method === "PUT"
            ? (Readable.toWeb(request) as ReadableStream<Uint8Array>)
            : undefined;
        const networkRequest = new Request(url, {
          method,
          headers,
          body,
          duplex: "half",
        } as RequestInit);
        const response = await handleAi(networkRequest);
        outgoing.writeHead(response.status, {
          ...security,
          ...Object.fromEntries(response.headers),
          "Cache-Control": "no-store",
        });
        outgoing.end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      if (
        url.pathname.startsWith("/api/") ||
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
      const localCookie =
        localOwner &&
        file === resolve(root, "index.html") &&
        request.headers.host === appUrl.host
          ? {
              "Set-Cookie": `${sessionName}=${localSession}; HttpOnly; SameSite=Strict; Path=/api/calio/ai`,
            }
          : {};
      outgoing.writeHead(200, {
        ...security,
        ...localCookie,
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
