import { mkdtemp, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createAiHttp } from "../../server/ai-http";
import { openAiSettings } from "../../server/ai-settings";
import { isPublicAddress } from "../../server/provider-network";

it("persists two configurable models privately and requires a new key for another base URL", async () => {
  const dir = await mkdtemp(join(tmpdir(), "calio-synthetic-settings-"));
  const file = join(dir, "settings.json");
  const initial = { apiKey: "", enabled: false };
  const profile = {
    baseUrl: "https://provider.example/v1/",
    model: "example/analysis",
    calorieModel: "example/search",
  };
  try {
    const store = await openAiSettings(file, initial);
    expect(store.publicSettings()).toMatchObject({
      enabled: false,
      hasKey: false,
    });
    expect((await store.save(profile)).status).toBe(400);
    expect(
      (
        await store.save({
          ...profile,
          baseUrl: "http://provider.example/v1",
          apiKey: "synthetic",
        })
      ).status,
    ).toBe(400);
    const result = await store.save({
      ...profile,
      apiKey: "synthetic-server-key-for-store",
    });
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      ...profile,
      baseUrl: "https://provider.example/v1",
      enabled: true,
    });
    expect(store.publicSettings()).not.toHaveProperty("apiKey");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(
      (await store.save({ ...profile, baseUrl: "https://other.example/v1" }))
        .status,
    ).toBe(400);
    const after = await openAiSettings(file, initial);
    expect(after.publicSettings()).toEqual(store.publicSettings());
    expect(
      (await after.save({ ...profile, model: "example/analysis-updated" }))
        .status,
    ).toBe(200);
    expect(after.publicSettings().revision).not.toBe(
      store.publicSettings().revision,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("permits public provider addresses and blocks local or special-use resolutions", () => {
  for (const ip of [
    "127.0.0.1",
    "10.50.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::42",
    "2001:db8::1",
  ]) {
    expect(isPublicAddress(ip), ip).toBe(false);
  }
  for (const ip of ["1.1.1.1", "2606:4700:4700::1111"]) {
    expect(isPublicAddress(ip), ip).toBe(true);
  }
});

it("renews an expired local owner session and keeps saved settings private", async () => {
  const dir = await mkdtemp(join(tmpdir(), "calio-owner-session-"));
  const file = join(dir, "settings.json");
  const initial = { apiKey: "", enabled: false };
  let appOrigin = "";
  let api: ReturnType<typeof createAiHttp>;
  const server = createServer((request, response) => {
    void api
      .respond(request, response, new URL(request.url ?? "/", appOrigin))
      .catch(() => response.writeHead(500).end());
  });
  try {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("local port");
    appOrigin = `http://127.0.0.1:${address.port}`;
    const start = async () =>
      createAiHttp({
        appOrigin,
        aiSettings: await openAiSettings(file, initial),
      });
    api = await start();

    const path = `${appOrigin}/api/calio/ai`;
    const headers = { "X-Calio-Request": "1" };
    const openSession = (origin = appOrigin) =>
      fetch(`${path}/session`, {
        method: "POST",
        headers: { ...headers, Origin: origin },
      });
    const getSettings = (cookie: string) =>
      fetch(`${path}/settings`, { headers: { ...headers, Cookie: cookie } });

    expect((await getSettings("")).status).toBe(403);
    expect((await openSession("https://foreign.example")).status).toBe(403);
    const session = await openSession();
    expect(session.status).toBe(204);
    expect(session.headers.get("set-cookie")).toContain(
      "HttpOnly; SameSite=Strict",
    );
    const cookie = session.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect((await getSettings(cookie)).status).toBe(200);

    const profile = {
      baseUrl: "https://provider.example/v1",
      model: "synthetic/analysis",
      calorieModel: "synthetic/search",
    };
    const saved = await fetch(`${path}/settings`, {
      method: "PUT",
      headers: {
        ...headers,
        Cookie: cookie,
        Origin: appOrigin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...profile,
        apiKey: "synthetic-session-test-key",
      }),
    });
    expect(saved.status).toBe(200);

    api = await start();
    expect((await getSettings(cookie)).status).toBe(403);
    const renewedCookie =
      (await openSession()).headers.get("set-cookie")?.split(";")[0] ?? "";
    const configuration = await getSettings(renewedCookie);
    expect(configuration.status).toBe(200);
    const result = await configuration.json();
    expect(result).toMatchObject({ ...profile, hasKey: true, enabled: true });
    expect(result).not.toHaveProperty("apiKey");
  } finally {
    const closed = once(server, "close");
    server.close();
    await closed;
    await rm(dir, { recursive: true, force: true });
  }
});
