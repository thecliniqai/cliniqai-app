import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  OpenAiGatewayClient,
  MockAiProvider,
} from "@/lib/ai/client";
import {
  generateSoapFromShorthand,
  sanitizePatientContextForPrompt,
} from "@/lib/ai/soap-generator";
import { SoapDraftZodSchema } from "@/lib/ai/types";

describe("Universal OpenAI-Compatible AI Gateway & Clinical SOAP Scribe (REQ-ai-features, T-05-10)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe("1. Provider Compatibility & MockAiProvider", () => {
    it("initializes MockAiProvider in dev/test environment with deterministic responses", async () => {
      const mockProvider = new MockAiProvider();
      const response = await mockProvider.generateChatResponse(
        [{ role: "user", content: "Patient c/o fever since 3 days" }],
        true
      );

      expect(response).toBeDefined();
      const parsed = JSON.parse(response);
      expect(parsed.chief_complaints).toBeInstanceOf(Array);
      expect(parsed.chief_complaints.length).toBeGreaterThan(0);
      expect(parsed.chief_complaints[0].complaint).toContain("Fever");
      expect(parsed.examination).toBeDefined();
      expect(parsed.advice).toBeDefined();
    });

    it("OpenAiGatewayClient defaults to Mock provider when no API key is provided", async () => {
      delete process.env.AI_API_KEY;
      const client = new OpenAiGatewayClient({ provider: "mock" });
      const output = await client.chatCompletion({
        messages: [{ role: "user", content: "dry cough" }],
        responseFormat: { type: "json_object" },
      });

      const parsed = JSON.parse(output);
      expect(parsed.chief_complaints[0].complaint).toBe("Dry cough");
    });

    it("conforms to OpenAI Chat Completions REST schema when API key is provided", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  chief_complaints: [{ complaint: "Headache", duration: "1 day", severity: "mild" }],
                  examination: "BP 120/80 mmHg",
                  diagnosis_hypothesis: "Tension headache",
                  advice: "Rest and hydration",
                }),
              },
            },
          ],
        }),
      });

      global.fetch = mockFetch;

      const client = new OpenAiGatewayClient({
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-real-api-key-12345",
        model: "gpt-4o-mini",
        provider: "openai",
      });

      const output = await client.chatCompletion({
        messages: [{ role: "user", content: "headache" }],
        responseFormat: { type: "json_object" },
        temperature: 0.2,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.openai.com/v1/chat/completions",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            Authorization: "Bearer sk-real-api-key-12345",
          }),
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: "headache" }],
            temperature: 0.2,
            response_format: { type: "json_object" },
          }),
        })
      );

      const parsed = JSON.parse(output);
      expect(parsed.diagnosis_hypothesis).toBe("Tension headache");
    });
  });

  describe("2. Zero Patient PII in External Prompts (T-05-10)", () => {
    it("sanitizes patient name, phone, national ID, and address before constructing AI prompt", () => {
      const sensitivePatient = {
        id: "patient-123",
        full_name: "Rahul Ramakant Sharma",
        name: "Rahul",
        phone: "+919876543210",
        address: "Flat 402, Shivajinagar, Pune 411005",
        abha_id: "14-digit-abha-id",
        national_id: "1234-5678-9012",
        email: "rahul@example.com",
        uhid: "UHID999",
        // Clinical attributes that SHOULD be retained:
        age: 42,
        sex: "male",
        existing_conditions: ["Type 2 Diabetes", "Hypertension"],
        vitals: { bp: "130/85", pulse: 76 },
      };

      const clean = sanitizePatientContextForPrompt(sensitivePatient);

      // Verify PII is completely absent
      expect((clean as any).full_name).toBeUndefined();
      expect((clean as any).name).toBeUndefined();
      expect((clean as any).phone).toBeUndefined();
      expect((clean as any).address).toBeUndefined();
      expect((clean as any).abha_id).toBeUndefined();
      expect((clean as any).national_id).toBeUndefined();
      expect((clean as any).email).toBeUndefined();
      expect((clean as any).uhid).toBeUndefined();
      expect((clean as any).id).toBeUndefined();

      // Verify clinical attributes are safely preserved
      expect(clean.age).toBe(42);
      expect(clean.sex).toBe("male");
      expect(clean.existing_conditions).toEqual(["Type 2 Diabetes", "Hypertension"]);
      expect(clean.vitals).toEqual({ bp: "130/85", pulse: 76 });
    });
  });

  describe("3. Structured SOAP Output & OPD Shorthand Normalization", () => {
    it("validates structured SOAP output using Zod schema", async () => {
      const result = await generateSoapFromShorthand({
        shorthand: "c/o fever 3d, o/e throat congested, adv steam",
      });

      const validation = SoapDraftZodSchema.safeParse(result);
      expect(validation.success).toBe(true);
      expect(result.chief_complaints.length).toBeGreaterThan(0);
      expect(result.examination).toBeTruthy();
      expect(result.advice).toBeTruthy();
    });

    it("returns empty draft for blank shorthand without error", async () => {
      const result = await generateSoapFromShorthand({
        shorthand: "   ",
      });

      expect(result.chief_complaints).toEqual([]);
      expect(result.examination).toBe("");
      expect(result.advice).toBe("");
    });
  });
});
