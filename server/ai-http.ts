import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { readAiSettingsInput, type openAiSettings } from "./ai-settings";
import { createGateway } from "./gateway";
import { fetchPublicProvider } from "./provider-network";

const settingsPath = "/api/calio/ai/settings";
const sessionPath = "/api/calio/ai/session";

export function isAiPath(pathname: string) {
  return ["/api/calio/ai", settingsPath, sessionPath].includes(pathname);
}

function matchesSecret(actual: string, expected: string) {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return (
    Boolean(right.length) &&
    left.length === right.length &&
    timingSafeEqual(left, right)
  );
}

export function createAiHttp({
  appOrigin,
  aiSettings,
  proxyToken = "",
}: {
  appOrigin: string;
  aiSettings: Awaited<ReturnType<typeof openAiSettings>>;
  proxyToken?: string;
}) {
  const appUrl = new URL(appOrigin);
  const localOwner =
    !proxyToken &&
    appUrl.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(appUrl.hostname);
  const sessionName = `calio_local_owner_${appUrl.port || "80"}`;
  const localSession = randomBytes(32).toString("hex");
  const sessionCookie = `${sessionName}=${localSession}; HttpOnly; SameSite=Strict; Path=/api/calio/ai`;

  function isLocalOwnerHost(host: string | null | undefined) {
    return localOwner && host === appUrl.host;
  }

  function authorized(request: Request) {
    if (proxyToken) {
      return matchesSecret(
        request.headers.get("x-calio-authenticated") ?? "",
        proxyToken,
      );
    }
    if (!isLocalOwnerHost(request.headers.get("host"))) return false;
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

  let gateway: ReturnType<typeof createGateway> | undefined;
  let boundRevision: string | undefined;
  async function handle(request: Request) {
    const path = new URL(request.url).pathname;
    const sameOrigin = request.headers.get("Origin") === appOrigin;
    const acceptedHeader = request.headers.get("X-Calio-Request") === "1";
    if (path === sessionPath) {
      if (
        request.method !== "POST" ||
        !acceptedHeader ||
        !sameOrigin ||
        !isLocalOwnerHost(request.headers.get("host"))
      ) {
        return new Response(null, { status: 403 });
      }
      return new Response(null, {
        status: 204,
        headers: { "Set-Cookie": sessionCookie },
      });
    }
    if (!authorized(request))
      return Response.json({ error: "gateway_auth" }, { status: 403 });

    if (path === settingsPath) {
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
    if (gateway === undefined || boundRevision !== active.revision) {
      gateway = createGateway({
        ...active,
        allowedOrigin: appOrigin,
        authenticate: authorized,
        fetchProvider: fetchPublicProvider,
      });
      boundRevision = active.revision;
    }
    return gateway(request);
  }

  return {
    ownerCookie: (host: string | undefined) =>
      isLocalOwnerHost(host) ? { "Set-Cookie": sessionCookie } : {},
    async respond(
      request: IncomingMessage,
      outgoing: ServerResponse,
      url: URL,
      extraHeaders: Record<string, string> = {},
    ) {
      const method = request.method ?? "GET";
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) {
        if (Array.isArray(value)) value.forEach((v) => headers.append(name, v));
        else if (value !== undefined) headers.set(name, value);
      }
      const body =
        method === "POST" || method === "PUT"
          ? (Readable.toWeb(request) as ReadableStream<Uint8Array>)
          : undefined;
      const response = await handle(
        new Request(url, {
          method,
          headers,
          body,
          duplex: "half",
        } as RequestInit),
      );
      outgoing.writeHead(response.status, {
        ...extraHeaders,
        ...Object.fromEntries(response.headers),
        "Cache-Control": "no-store",
      });
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    },
  };
}
