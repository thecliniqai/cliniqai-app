import { afterAll, beforeAll, vi } from "vitest";

/**
 * The `/api/v1` handlers check API_V1_ENABLED themselves (AR2-H2, plan 01-09), not only the middleware. A spec that
 * calls v1 handlers directly calls this once at the top level: the API is on for the whole file and the variable is
 * restored afterwards (NODE_ENV is "test" in the test lane, so `apiV1Enabled()` is true).
 */
export function enableApiV1ForFile(): void {
  beforeAll(() => {
    vi.stubEnv("API_V1_ENABLED", "true");
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });
}
