/**
 * AI-01 containment regression (V2-01 acceptance: "no `/api/ai/*` copilot route is reachable"; AI_STRATEGY.md
 * §4.6 "AI unavailable ... never mock output"; §8 AI-P0).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { requirePermissionMock, createClientMock, getSystemDbMock } = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
  createClientMock: vi.fn(),
  getSystemDbMock: vi.fn(),
}));

vi.mock("@/lib/permissions/guards", () => ({ requirePermission: requirePermissionMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/lib/supabase/system", () => ({ getSystemDb: getSystemDbMock }));

import * as aiLib from "@/lib/ai";
import { generateSoapAction, getPatientCatchUpSummaryAction } from "@/features/ai/actions";

/**
 * The App Router's route and page modules, as the bundler resolves them (lazy: nothing is imported). A request
 * path is reachable only if one of these files matches it.
 */
const ROUTE_MODULES = Object.keys(import.meta.glob(["/app/**/route.{ts,tsx,js}", "/app/**/page.{ts,tsx,js}"]));

/** Convert an App Router file path into a matcher for request paths (groups, dynamic and catch-all segments). */
function routeMatcher(file: string): RegExp {
  const segments = file
    .replace(/^\/app/, "")
    .replace(/\/(route|page)\.(ts|tsx|js)$/, "")
    .split("/")
    .filter((seg) => seg && !/^\(.*\)$/.test(seg) && !seg.startsWith("@"));
  let pattern = "";
  for (const seg of segments) {
    if (/^\[\[\.\.\..+\]\]$/.test(seg)) pattern += "(?:/.*)?";
    else if (/^\[\.\.\..+\]$/.test(seg)) pattern += "/.+";
    else if (/^\[.+\]$/.test(seg)) pattern += "/[^/]+";
    else pattern += "/" + seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${pattern || "/"}$`);
}

const SESSION = {
  tenantId: "00000000-0000-0000-0000-000000000001",
  userId: "00000000-0000-0000-0000-000000000002",
  role: "doctor",
};

const RETIRED_MOCK_STRINGS = ["Acute Upper Respiratory Tract Infection", "Ramesh Sharma", "Azithromycin"];

describe("AI-01 containment", () => {
  describe("copilot routes are gone", () => {
    it("the route set is non-empty and still resolves a known API route (control)", () => {
      expect(ROUTE_MODULES.length).toBeGreaterThan(10);
      expect(ROUTE_MODULES.some((f) => routeMatcher(f).test("/api/health"))).toBe(true);
    });

    it.each(["/api/ai/operations-copilot", "/api/ai/clinical-copilot", "/api/ai/anything", "/api/ai"])(
      "no App Router module serves %s",
      (requestPath) => {
        const matches = ROUTE_MODULES.filter((f) => routeMatcher(f).test(requestPath));
        expect(matches).toEqual([]);
      }
    );

    it("control: a live route module imports through the same mechanism", async () => {
      const specifier = "@/app/api/health/route";
      const mod = await import(/* @vite-ignore */ specifier);
      expect(typeof mod.GET).toBe("function");
    });

    it.each(["@/app/api/ai/operations-copilot/route", "@/app/api/ai/clinical-copilot/route"])(
      "the former module %s cannot be imported",
      async (specifier) => {
        await expect(import(/* @vite-ignore */ specifier)).rejects.toThrow();
      }
    );

    it("the AI library no longer exports the mock provider, the AI SDK model or the regex extractor", () => {
      const exported = Object.keys(aiLib);
      for (const name of [
        "MockAiProvider",
        "getAiGatewayModel",
        "geminiFetchInterceptor",
        "extractStructuredSoap",
        "parseShorthandLocally",
      ]) {
        expect(exported).not.toContain(name);
      }
    });
  });

  describe("scribe and catch-up fail closed without a provider", () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      requirePermissionMock.mockReset().mockResolvedValue(SESSION);
      createClientMock.mockReset();
      getSystemDbMock.mockReset();
      fetchSpy = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 })
      );
      vi.stubGlobal("fetch", fetchSpy);
      vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    const unconfigured: Array<[string, Record<string, string>]> = [
      ["the test lane defaults (AI_PROVIDER=mock, AI_ENABLED unset)", {}],
      ["AI_ENABLED=true with AI_PROVIDER=mock", { AI_ENABLED: "true", AI_PROVIDER: "mock", AI_MODEL_NAME: "m" }],
      ["AI_ENABLED=true with an incomplete config", { AI_ENABLED: "true", AI_PROVIDER: "openai", AI_MODEL_NAME: "m" }],
    ];

    it.each(unconfigured)("generateSoapAction returns AI unavailable and calls nothing: %s", async (_label, env) => {
      for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);

      const result = await generateSoapAction({ shorthand: "c/o fever 3d, o/e throat congested, adv steam" });

      expect(result).toEqual({
        success: false,
        code: "AI_UNAVAILABLE",
        reason: "not_configured",
        error: "AI unavailable",
      });
      expect(result).not.toHaveProperty("draft");
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(requirePermissionMock).toHaveBeenCalledWith("consultations:edit");
      for (const s of RETIRED_MOCK_STRINGS) expect(JSON.stringify(result)).not.toContain(s);
    });

    it.each(unconfigured)(
      "getPatientCatchUpSummaryAction returns AI unavailable, reads no data and calls nothing: %s",
      async (_label, env) => {
        for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);

        const result = await getPatientCatchUpSummaryAction({ patientId: "00000000-0000-0000-0000-000000000003" });

        expect(result).toEqual({
          success: false,
          code: "AI_UNAVAILABLE",
          reason: "not_configured",
          error: "AI unavailable",
        });
        expect(result).not.toHaveProperty("summary");
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(createClientMock).not.toHaveBeenCalled();
        expect(getSystemDbMock).not.toHaveBeenCalled();
      }
    );

    it("control: with a complete config the scribe does reach the provider (so the no-call assertions are live)", async () => {
      vi.stubEnv("AI_ENABLED", "true");
      vi.stubEnv("AI_PROVIDER", "openai");
      vi.stubEnv("AI_API_KEY", "x");
      vi.stubEnv("AI_MODEL_NAME", "m");
      vi.stubEnv("AI_BASE_URL", "http://127.0.0.1:9/v1");

      const result = await generateSoapAction({ shorthand: "c/o fever 3d" });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0][0]).toBe("http://127.0.0.1:9/v1/chat/completions");
      expect(result).toEqual({ success: true, draft: expect.objectContaining({ chief_complaints: [] }) });
    });

    it("a provider error produces AI unavailable with no draft", async () => {
      vi.stubEnv("AI_ENABLED", "true");
      vi.stubEnv("AI_PROVIDER", "openai");
      vi.stubEnv("AI_API_KEY", "x");
      vi.stubEnv("AI_MODEL_NAME", "m");
      vi.stubEnv("AI_BASE_URL", "http://127.0.0.1:9/v1");
      fetchSpy.mockResolvedValue(new Response("upstream down", { status: 503 }));

      const result = await generateSoapAction({ shorthand: "c/o fever 3d" });

      expect(result).toEqual({
        success: false,
        code: "AI_UNAVAILABLE",
        reason: "provider_error",
        error: "AI unavailable",
      });
    });

    it("a permission failure is reported before any AI work", async () => {
      requirePermissionMock.mockRejectedValue(new Error("Forbidden"));
      const result = await generateSoapAction({ shorthand: "c/o fever 3d" });
      expect(result).toEqual({ success: false, code: "ERROR", error: "Failed to generate clinical notes." });
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
