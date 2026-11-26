import { describe, expect, it, vi } from "vitest";
import { createGateway } from "../../server/gateway";
import fixture from "../../fixtures/extract-input.json";
import extraction from "../../fixtures/extract-output.json";
import { nutrientKeys } from "../../src/domain/nutrition";

const origin = "https://calio.example.test";
const providerKey = "synthetic-server-key";
const key = "f".repeat(64);
const input = { ...fixture, locale: "fa" };
function request(
  body: unknown,
  options: { token?: string; origin?: string; method?: string } = {},
) {
  return new Request(`${origin}/api/calio/ai`, {
    method: options.method ?? "POST",
    headers: {
      Origin: options.origin ?? origin,
      "Content-Type": "application/json",
      "X-Test-Session": options.token ?? "synthetic-session",
    },
    body: JSON.stringify(body),
  });
}

function envelope(operation: string, data: unknown, idempotencyKey = key) {
  return {
    operation,
    input: data,
    idempotencyKey,
    requestId: crypto.randomUUID(),
    schemaVersion: 1,
  };
}

const auth = (candidate: Request) =>
  candidate.headers.get("X-Test-Session") === "synthetic-session";
const reply = () =>
  Response.json({
    choices: [{ message: { content: JSON.stringify(extraction) } }],
    usage: { prompt_tokens: 100, completion_tokens: 50 },
  });

describe("authenticated gateway, synthetic upstream", () => {
  it("rejects absent authentication, foreign origins, and arbitrary operations before a provider call", async () => {
    const fetchProvider: typeof fetch = vi.fn(async () => reply());
    const gateway = createGateway({
      apiKey: providerKey,
      allowedOrigin: origin,
      authenticate: auth,
      fetchProvider,
    });
    expect(
      (await gateway(request(envelope("extract", input), { token: "" })))
        .status,
    ).toBe(403);
    expect(
      (
        await gateway(
          request(envelope("extract", input), {
            origin: "https://elsewhere.test",
          }),
        )
      ).status,
    ).toBe(403);
    expect((await gateway(request(envelope("arbitrary", input)))).status).toBe(
      400,
    );
    expect(fetchProvider).not.toHaveBeenCalled();
  });

  it("separates trusted prompts and diary text, validates returned IDs, and avoids live external calls", async () => {
    const fetchProvider: typeof fetch = vi.fn(async (url, init) => {
      expect(url).toBe("https://iranrouter.net/api/v1/chat/completions");
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        `Bearer ${providerKey}`,
      );
      const sent = JSON.parse(String(init?.body));
      expect(sent.model).toBe("openai/gpt-6-luna");
      expect(sent.messages[0].content).not.toContain(fixture.entries[0]?.text);
      expect(sent.messages[1].role).toBe("user");
      expect(JSON.parse(sent.messages[1].content)).toEqual(input);
      return reply();
    });
    const gateway = createGateway({
      apiKey: providerKey,
      allowedOrigin: origin,
      authenticate: auth,
      fetchProvider,
    });
    const body = envelope("extract", input);
    const result = await gateway(request(body));
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("no-store");
    const answer = await result.json();
    expect(answer).toMatchObject({
      requestId: body.requestId,
      output: extraction,
      usage: { inputTokens: 100, outputTokens: 50 },
    });
    expect(JSON.stringify(answer)).not.toContain(providerKey);
  });

  it("fails closed when research has no verified search connector or output is malformed", async () => {
    const fetchProvider = vi.fn(async () =>
      Response.json({
        choices: [{ message: { content: "```json\n{}\n```" } }],
      }),
    );
    const gateway = createGateway({
      apiKey: providerKey,
      allowedOrigin: origin,
      authenticate: auth,
      fetchProvider,
    });
    const research = {
      food_name_fa: "نان",
      food_name_en: "bread",
      variant: "plain",
      preparation: "unknown",
      brand: null,
      requested_nutrient_keys: nutrientKeys,
      known_reference: null,
      locale: "fa",
    };
    expect(
      (await gateway(request(envelope("research", research)))).status,
    ).toBe(501);
    expect(fetchProvider).not.toHaveBeenCalled();
    expect((await gateway(request(envelope("extract", input)))).status).toBe(
      422,
    );
  });

  it("deduplicates concurrent requests without retaining output after completion", async () => {
    let unblock: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const fetchProvider = vi.fn(async () => {
      await gate;
      return reply();
    });
    const gateway = createGateway({
      apiKey: providerKey,
      allowedOrigin: origin,
      authenticate: auth,
      fetchProvider,
    });
    const first = gateway(request(envelope("extract", input)));
    const second = gateway(request(envelope("extract", input)));
    await vi.waitFor(() => expect(fetchProvider).toHaveBeenCalledTimes(1));
    unblock?.();
    const results = await Promise.all([first, second]);
    expect(results.map((response) => response.status)).toEqual([200, 200]);
    expect(fetchProvider).toHaveBeenCalledTimes(1);
  });
});

describe("calorie research through plain Sonar", () => {
  const target = {
    nameFa: "خوراک آزمایشی",
    nameEn: "",
    variant: "",
    preparation: "cooked",
    brand: null,
    basis: "per_100g",
  };
  const source = {
    url: "https://nutrition.example/only-food",
    title: "Synthetic calorie reference",
  };
  const output = {
    status: "known",
    kcalPer100: 123,
    basis: target.basis,
    source,
  };

  it("sends only food identity to Sonar and returns energy-only source metadata", async () => {
    const fetchProvider: typeof fetch = vi.fn(async (_url, init) => {
      const sent = JSON.parse(String(init?.body));
      expect(sent.model).toBe("perplexity/sonar");
      expect(sent.max_tokens).toBe(240);
      expect(JSON.parse(sent.messages[1].content)).toEqual(target);
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify(output),
              annotations: [
                {
                  type: "url_citation",
                  url_citation: { url: source.url + "#table" },
                },
              ],
            },
          },
        ],
      });
    });
    const gateway = createGateway({
      apiKey: providerKey,
      allowedOrigin: origin,
      authenticate: auth,
      fetchProvider,
    });
    const invalid = await gateway(
      request(
        envelope("calories", { ...target, privateNote: "synthetic note" }),
      ),
    );
    expect(invalid.status).toBe(400);
    expect(fetchProvider).not.toHaveBeenCalled();
    const response = await gateway(request(envelope("calories", target)));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      model: "perplexity/sonar",
      output,
      evidence: [
        {
          ...source,
          supportedNutrients: ["energy_kcal"],
          supportsPortion: false,
        },
      ],
    });
    expect(fetchProvider).toHaveBeenCalledTimes(1);
  });

  it("rejects a source URL appearing only in the model JSON", async () => {
    const fetchProvider: typeof fetch = vi.fn(async () =>
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify(output),
              annotations: [
                {
                  type: "url_citation",
                  url: "https://nutrition.example/other-food",
                },
              ],
            },
          },
        ],
      }),
    );
    const gateway = createGateway({
      apiKey: providerKey,
      allowedOrigin: origin,
      authenticate: auth,
      fetchProvider,
    });
    const response = await gateway(request(envelope("calories", target)));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: "ai_evidence" });
    expect(fetchProvider).toHaveBeenCalledTimes(1);
  });
});

it("routes both configured model IDs to a compatible provider and checks native citations", async () => {
  const source = "https://nutrition.example/synthetic";
  const gateway = createGateway({
    apiKey: providerKey,
    allowedOrigin: origin,
    authenticate: auth,
    baseUrl: "https://provider.example/compatible/v1/",
    model: "custom/analysis",
    calorieModel: "custom/search",
    fetchProvider: vi.fn(async (url, init) => {
      expect(url).toBe(
        "https://provider.example/compatible/v1/chat/completions",
      );
      const sent = JSON.parse(String(init?.body));
      if (sent.model === "custom/analysis") return reply();
      expect(sent.model).toBe("custom/search");
      return Response.json({
        citations: [source],
        choices: [
          {
            message: {
              content: JSON.stringify({
                status: "known",
                kcalPer100: 123,
                basis: "per_100g",
                source: { url: source, title: "Synthetic label" },
              }),
            },
          },
        ],
      });
    }),
  });
  expect(
    await (await gateway(request(envelope("extract", input)))).json(),
  ).toMatchObject({
    model: "custom/analysis",
    provider: "provider.example",
  });
  expect(
    await (
      await gateway(
        request(
          envelope("calories", {
            nameFa: "",
            nameEn: "Synthetic dish",
            variant: "",
            preparation: "",
            brand: null,
            basis: "per_100g",
          }),
        ),
      )
    ).json(),
  ).toMatchObject({
    model: "custom/search",
    provider: "provider.example",
    evidence: [{ url: source, supportedNutrients: ["energy_kcal"] }],
  });
});
