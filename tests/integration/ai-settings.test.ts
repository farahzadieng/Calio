import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
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
