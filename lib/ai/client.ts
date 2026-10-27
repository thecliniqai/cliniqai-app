import { AiChatMessage, AiClientConfig, SoapDraft } from "./types";

export class MockAiProvider {
  async generateChatResponse(
    messages: AiChatMessage[],
    isJson = false
  ): Promise<string> {
    const userPrompt = messages.find((m) => m.role === "user")?.content || "";

    // If prompt is for Catch-Up summary
    if (userPrompt.toLowerCase().includes("catch-up") || userPrompt.toLowerCase().includes("catchup")) {
      return JSON.stringify({
        bullets: [
          "Last visit (14d ago): Presented with viral fever, resolved on symptomatic treatment.",
          "Medication History: Completed course of Azithromycin 500mg and Paracetamol 650mg.",
          "Alerts & Chronic: Known mild hypertension; no drug allergies reported.",
        ],
      });
    }

    // Default: Mock Clinical SOAP Note response
    const mockSoap: SoapDraft = {
      chief_complaints: [
        {
          complaint: userPrompt.toLowerCase().includes("cough") ? "Dry cough" : "Fever with chills",
          duration: "3 days",
          severity: "moderate",
        },
      ],
      examination: "Throat congested, bilateral air entry equal. No wheeze. Vitals stable.",
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
    this.baseUrl = config?.baseUrl || process.env.AI_BASE_URL || "https://api.openai.com/v1";
    this.apiKey = config?.apiKey || process.env.AI_API_KEY || "";
    this.model = config?.model || process.env.AI_MODEL_NAME || "gpt-4o-mini";
    this.provider =
      config?.provider ||
      process.env.AI_PROVIDER ||
      (this.apiKey ? "openai" : "mock");
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

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
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
