import { describe, it, expect, vi, afterEach } from "vitest";
import {
  AiChatClient,
  AiUnavailableError,
  OpenAiGatewayClient,
  resolveAiProviderConfig,
} from "@/lib/ai/client";
import {
  generateSoapFromShorthand,
  sanitizePatientContextForPrompt,
} from "@/lib/ai/soap-generator";
import { SoapDraftZodSchema } from "@/lib/ai/types";

// AI-01: no MockAiProvider. Tests inject a fake adapter (AI_STRATEGY.md §7 L2) or stub `fetch`.
function fakeClient(impl: AiChatClient["chatCompletion"]) {
  const chatCompletion = vi.fn<AiChatClient["chatCompletion"]>(impl);
  return { client: { chatCompletion } satisfies AiChatClient, chatCompletion };
}

async function expectUnavailable(promise: Promise<unknown>, reason: string) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(err).toBeInstanceOf(AiUnavailableError);
  expect((err as AiUnavailableError).reason).toBe(reason);
}

const COMPLETE_ENV = {
  AI_ENABLED: "true",
  AI_PROVIDER: "openai",
  AI_API_KEY: "x",
  AI_MODEL_NAME: "model-x",
  AI_BASE_URL: "http://127.0.0.1:9/v1",
};

describe("AI gateway and SOAP scribe (AI-01 fail-closed)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("1. Provider configuration", () => {
    it("returns a configuration only when AI is enabled and every value is set", () => {
      expect(resolveAiProviderConfig(COMPLETE_ENV)).toEqual({
        provider: "openai",
        apiKey: "x",
        model: "model-x",
        baseUrl: "http://127.0.0.1:9/v1",
      });
    });

    it.each([
      ["AI_ENABLED unset", { ...COMPLETE_ENV, AI_ENABLED: undefined }],
      ["AI_ENABLED false", { ...COMPLETE_ENV, AI_ENABLED: "false" }],
      ["AI_PROVIDER=mock", { ...COMPLETE_ENV, AI_PROVIDER: "mock" }],
      ["AI_PROVIDER unset", { ...COMPLETE_ENV, AI_PROVIDER: undefined }],
      ["unknown provider", { ...COMPLETE_ENV, AI_PROVIDER: "something" }],
      ["no API key", { ...COMPLETE_ENV, AI_API_KEY: "" }],
      ["no model", { ...COMPLETE_ENV, AI_MODEL_NAME: undefined }],
      ["no base URL", { ...COMPLETE_ENV, AI_BASE_URL: undefined }],
    ])("has no provider when %s", (_label, env) => {
      expect(resolveAiProviderConfig(env)).toBeNull();
    });

    it("the test lane itself (AI_PROVIDER=mock) has no provider", () => {
      expect(process.env.AI_PROVIDER).toBe("mock");
      expect(resolveAiProviderConfig()).toBeNull();
    });
  });

  describe("2. OpenAI-compatible client", () => {
    const config = {
      provider: "openai" as const,
      baseUrl: "http://127.0.0.1:9/v1",
      apiKey: "x",
      model: "model-x",
    };

    it("posts a Chat Completions request and returns the content", async () => {
      const fetchSpy = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 })
      );
      vi.stubGlobal("fetch", fetchSpy);

      const output = await new OpenAiGatewayClient(config).chatCompletion({
        messages: [{ role: "user", content: "headache" }],
        responseFormat: { type: "json_object" },
        temperature: 0.2,
      });

      expect(output).toBe('{"ok":true}');
      expect(fetchSpy).toHaveBeenCalledWith(
        "http://127.0.0.1:9/v1/chat/completions",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ Authorization: "Bearer x" }),
          body: JSON.stringify({
            model: "model-x",
            messages: [{ role: "user", content: "headache" }],
            temperature: 0.2,
            response_format: { type: "json_object" },
          }),
        })
      );
    });

    it("maps a provider error to AiUnavailableError without exposing the provider body", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("echo: secret prompt", { status: 500 })));
      const err = await new OpenAiGatewayClient(config)
        .chatCompletion({ messages: [{ role: "user", content: "x" }] })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AiUnavailableError);
      expect((err as AiUnavailableError).reason).toBe("provider_error");
      expect((err as Error).message).not.toContain("secret prompt");
    });

    it("maps a network failure to provider_error and an empty completion to invalid_output", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
      await expectUnavailable(
        new OpenAiGatewayClient(config).chatCompletion({ messages: [] }),
        "provider_error"
      );

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [] }), { status: 200 }))
      );
      await expectUnavailable(
        new OpenAiGatewayClient(config).chatCompletion({ messages: [] }),
        "invalid_output"
      );
    });
  });

  describe("3. Zero patient PII in external prompts (T-05-10)", () => {
    it("sanitizes patient name, phone, national ID, and address before constructing AI prompt", () => {
      const sensitivePatient = {
        id: "patient-123",
        full_name: "Synthetic Patient",
        name: "Synthetic",
        phone: "+910000000000",
        address: "Synthetic address",
        abha_id: "14-digit-abha-id",
        national_id: "0000-0000-0000",
        email: "patient@example.test",
        uhid: "UHID999",
        age: 42,
        sex: "male",
        existing_conditions: ["Type 2 Diabetes", "Hypertension"],
        vitals: { bp: "130/85", pulse: 76 },
      };

      const clean = sanitizePatientContextForPrompt(sensitivePatient) as Record<string, unknown>;

      for (const key of ["full_name", "name", "phone", "address", "abha_id", "national_id", "email", "uhid", "id"]) {
        expect(clean[key]).toBeUndefined();
      }
      expect(clean.age).toBe(42);
      expect(clean.sex).toBe("male");
      expect(clean.existing_conditions).toEqual(["Type 2 Diabetes", "Hypertension"]);
      expect(clean.vitals).toEqual({ bp: "130/85", pulse: 76 });
    });
  });

  describe("4. SOAP draft from the provider, fail closed otherwise", () => {
    const validDraft = {
      chief_complaints: [{ complaint: "Fever", duration: "3 days", severity: "moderate" }],
      examination: "Throat congested",
      diagnosis_hypothesis: "",
      advice: "Steam inhalation",
    };

    it("returns the provider's draft when it matches the schema", async () => {
      const fake = fakeClient(async () => JSON.stringify(validDraft));
      const result = await generateSoapFromShorthand(
        { shorthand: "c/o fever 3d, o/e throat congested, adv steam" },
        fake.client
      );
      expect(SoapDraftZodSchema.safeParse(result).success).toBe(true);
      expect(result).toEqual(validDraft);
      expect(fake.chatCompletion).toHaveBeenCalledTimes(1);
    });

    it("produces no draft when no provider is configured, and makes no outbound call", async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      await expectUnavailable(generateSoapFromShorthand({ shorthand: "c/o fever 3d" }), "not_configured");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it.each([
      ["non-JSON output", "c/o fever. o/e normal"],
      ["schema-invalid output", JSON.stringify({ chief_complaints: "fever", examination: 42 })],
    ])("produces no draft for %s (no regex or partial fallback)", async (_label, output) => {
      const fake = fakeClient(async () => output);
      await expectUnavailable(
        generateSoapFromShorthand({ shorthand: "c/o fever 3d" }, fake.client),
        "invalid_output"
      );
    });

    it("produces no draft when the provider throws", async () => {
      const fake = fakeClient(async () => {
        throw new Error("upstream failure");
      });
      await expectUnavailable(
        generateSoapFromShorthand({ shorthand: "c/o fever 3d" }, fake.client),
        "provider_error"
      );
    });

    it("returns an empty draft for blank shorthand without calling the provider", async () => {
      const fake = fakeClient(async () => JSON.stringify(validDraft));
      const result = await generateSoapFromShorthand({ shorthand: "   " }, fake.client);
      expect(result).toEqual({ chief_complaints: [], examination: "", diagnosis_hypothesis: "", advice: "" });
      expect(fake.chatCompletion).not.toHaveBeenCalled();
    });
  });
});
