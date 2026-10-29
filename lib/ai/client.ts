import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { AiChatMessage, AiClientConfig, SoapDraft } from "./types";

export function getAiGatewayModel() {
  const provider = (process.env.AI_PROVIDER || "openai").toLowerCase();
  const apiKey =
    process.env.AI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    "test-api-key";
  const modelName =
    process.env.AI_MODEL_NAME ||
    (provider === "gemini" || provider === "google"
      ? "gemini-2.0-flash"
      : "gpt-4o-mini");

  if (
    provider === "gemini" ||
    provider === "google" ||
    modelName.toLowerCase().startsWith("gemini")
  ) {
    const google = createGoogleGenerativeAI({
      apiKey,
      baseURL: process.env.AI_BASE_URL,
    });
    return google(modelName);
  }

  const baseURL = process.env.AI_BASE_URL || "https://api.openai.com/v1";
  const openai = createOpenAI({
    baseURL,
    apiKey,
  });

  return openai(modelName);
}

export class MockAiProvider {
  async generateChatResponse(
    messages: AiChatMessage[],
    isJson = false
  ): Promise<string> {
    const userPrompt = messages.find((m) => m.role === "user")?.content || "";

    // If prompt is for Catch-Up summary
    if (
      userPrompt.toLowerCase().includes("catch-up") ||
      userPrompt.toLowerCase().includes("catchup")
    ) {
      return JSON.stringify({
        bullets: [
          "Last visit (14d ago): Presented with viral fever, resolved on symptomatic treatment.",
          "Medication History: Completed course of Azithromycin 500mg and Paracetamol 650mg.",
          "Alerts & Chronic: Known mild hypertension; no drug allergies reported.",
        ],
      });
    }

    // Operations tool mocking: Patient search
    if (
      userPrompt.toLowerCase().includes("search patient") ||
      userPrompt.toLowerCase().includes("find patient")
    ) {
      return JSON.stringify({
        patients: [
          {
            id: "11111111-1111-1111-1111-111111111111",
            full_name: "Ramesh Sharma",
            phone: "+919876543210",
            age: 45,
            sex: "male",
            last_visit_date: "2026-10-15",
          },
        ],
      });
    }

    // Operations tool mocking: Doctor availability
    if (
      userPrompt.toLowerCase().includes("availability") ||
      userPrompt.toLowerCase().includes("slots")
    ) {
      return JSON.stringify({
        available_slots: ["09:00", "09:15", "09:30", "10:00", "11:30"],
        shifts: [{ start_time: "09:00", end_time: "13:00" }],
      });
    }

    // Operations tool mocking: Booking preview
    if (
      userPrompt.toLowerCase().includes("booking") ||
      userPrompt.toLowerCase().includes("book appointment")
    ) {
      return JSON.stringify({
        status: "preview_ready",
        requires_confirmation: true,
        details: {
          patient_id: "11111111-1111-1111-1111-111111111111",
          patient_name: "Ramesh Sharma",
          phone: "+919876543210",
          doctor_id: "22222222-2222-2222-2222-222222222222",
          doctor_name: "Dr. A. Verma",
          date: "2026-10-30",
          start_time: "10:00",
          consultation_type: "in_person",
          fee: 500,
          outside_shift_warning: false,
        },
      });
    }

    // Default: Mock Clinical SOAP Note response
    const mockSoap: SoapDraft = {
      chief_complaints: [
        {
          complaint: userPrompt.toLowerCase().includes("cough")
            ? "Dry cough"
            : "Fever with chills",
          duration: "3 days",
          severity: "moderate",
        },
      ],
      examination:
        "Throat congested, bilateral air entry equal. No wheeze. Vitals stable.",
      diagnosis_hypothesis: "Acute Upper Respiratory Tract Infection",
      advice: "Adequate hydration, warm saline gargles twice daily, light diet.",
    };

    return isJson ? JSON.stringify(mockSoap) : mockSoap.examination;
  }
}

export class OpenAiGatewayClient {
  public baseUrl: string;
  public apiKey: string;
  public model: string;
  public provider: string;
  private mockProvider: MockAiProvider;

  constructor(config?: Partial<AiClientConfig>) {
    const rawProvider =
      config?.provider ||
      process.env.AI_PROVIDER ||
      (config?.apiKey || process.env.AI_API_KEY || process.env.GEMINI_API_KEY ? "openai" : "mock");
    const isGemini =
      rawProvider.toLowerCase() === "gemini" ||
      rawProvider.toLowerCase() === "google" ||
      (config?.model || process.env.AI_MODEL_NAME || "").toLowerCase().startsWith("gemini");

    this.provider = rawProvider;
    this.baseUrl =
      config?.baseUrl ||
      process.env.AI_BASE_URL ||
      (isGemini
        ? "https://generativelanguage.googleapis.com/v1beta/openai"
        : "https://api.openai.com/v1");
    this.apiKey =
      config?.apiKey ||
      process.env.AI_API_KEY ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      "";
    this.model =
      config?.model ||
      process.env.AI_MODEL_NAME ||
      (isGemini ? "gemini-2.0-flash" : "gpt-4o-mini");
    this.mockProvider = new MockAiProvider();
  }

  async chatCompletion(options: {
    messages: AiChatMessage[];
    responseFormat?: { type: "json_object" };
    temperature?: number;
  }): Promise<string> {
    const isJson = options.responseFormat?.type === "json_object";

    // Use mock provider if mock requested, apiKey missing, or test environment with no real key
    if (
      this.provider === "mock" ||
      !this.apiKey ||
      this.apiKey === "test-api-key" ||
      this.apiKey.startsWith("mock-")
    ) {
      return this.mockProvider.generateChatResponse(options.messages, isJson);
    }

    const endpoint = `${this.baseUrl.replace(/\/$/, "")}/chat/completions`;

    const payload: Record<string, unknown> = {
      model: this.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.2,
    };

    if (options.responseFormat) {
      payload.response_format = options.responseFormat;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };

    // Google Generative AI OpenAI-compatible endpoint accepts both Bearer and x-goog-api-key
    if (
      this.provider.toLowerCase() === "gemini" ||
      this.provider.toLowerCase() === "google" ||
      this.baseUrl.includes("generativelanguage.googleapis.com")
    ) {
      headers["x-goog-api-key"] = this.apiKey;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`AI Gateway error (${response.status}): ${errText}`);
    }

    const json = await response.json();
    const content = json.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("AI Gateway returned an empty completion response.");
    }

    return content;
  }
}
