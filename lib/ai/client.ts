import { AiChatMessage, AiProviderConfig, AiProviderName } from "./types";

/**
 * AI-01 (AI_STRATEGY.md §4.6, §7): there is no mock provider and no test-only branch. When no provider is
 * configured, every AI feature fails closed with `AiUnavailableError`: no draft, no canned or regex output and
 * no outbound call. Tests inject a fake `AiChatClient`; production code never inspects the test runner.
 */
export type AiUnavailableReason = "not_configured" | "provider_error" | "invalid_output";

export class AiUnavailableError extends Error {
  constructor(public readonly reason: AiUnavailableReason) {
    super("AI unavailable");
    this.name = "AiUnavailableError";
  }
}

export interface AiChatClient {
  chatCompletion(options: {
    messages: AiChatMessage[];
    responseFormat?: { type: "json_object" };
    temperature?: number;
  }): Promise<string>;
}

const SUPPORTED_PROVIDERS: readonly AiProviderName[] = [
  "openai",
  "gemini",
  "claude",
  "groq",
  "ollama",
  "deepseek",
];

/**
 * Resolves the provider configuration from the environment, or `null` when AI is not enabled and fully
 * configured. Nothing is defaulted: `AI_ENABLED=true` (deploy-level kill switch, §4.6) plus an explicit
 * supported `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL_NAME` and `AI_BASE_URL` are all required. Any other value of
 * `AI_PROVIDER` (including the former `mock`) means "no provider".
 */
export function resolveAiProviderConfig(
  env: Record<string, string | undefined> = process.env
): AiProviderConfig | null {
  if (env.AI_ENABLED !== "true") return null;

  const provider = (env.AI_PROVIDER ?? "").trim().toLowerCase() as AiProviderName;
  if (!SUPPORTED_PROVIDERS.includes(provider)) return null;

  const apiKey = (env.AI_API_KEY ?? "").trim();
  const model = (env.AI_MODEL_NAME ?? "").trim();
  const baseUrl = (env.AI_BASE_URL ?? "").trim();
  if (!apiKey || !model || !baseUrl) return null;

  return { provider, apiKey, model, baseUrl };
}

/** Returns a chat client for the configured provider, or `null` when AI is unavailable. */
export function getAiChatClient(
  env: Record<string, string | undefined> = process.env
): AiChatClient | null {
  const config = resolveAiProviderConfig(env);
  return config ? new OpenAiGatewayClient(config) : null;
}

/** OpenAI-compatible Chat Completions client. Constructed only from a complete configuration. */
export class OpenAiGatewayClient implements AiChatClient {
  constructor(private readonly config: AiProviderConfig) {}

  async chatCompletion(options: {
    messages: AiChatMessage[];
    responseFormat?: { type: "json_object" };
    temperature?: number;
  }): Promise<string> {
    const endpoint = `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`;

    const payload: Record<string, unknown> = {
      model: this.config.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.2,
    };
    if (options.responseFormat) {
      payload.response_format = options.responseFormat;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.apiKey}`,
    };
    if (this.config.provider === "gemini") {
      headers["x-goog-api-key"] = this.config.apiKey;
    }

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
    } catch {
      throw new AiUnavailableError("provider_error");
    }

    // The provider's error body is not read or propagated: it can echo the prompt.
    if (!response.ok) {
      throw new AiUnavailableError("provider_error");
    }

    let json: { choices?: Array<{ message?: { content?: unknown } }> };
    try {
      json = await response.json();
    } catch {
      throw new AiUnavailableError("invalid_output");
    }

    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content) {
      throw new AiUnavailableError("invalid_output");
    }
    return content;
  }
}
