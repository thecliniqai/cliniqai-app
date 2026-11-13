/**
 * V2-03 03-09b (R-18, T-03-15): `POST /api/diag/error`, called as a handler.
 *
 * The bearer is checked first (CRON_SECRET unset, missing, wrong or without `Bearer` → 401, whatever the flag), then
 * the flag (off → 404 with an empty body), and only then does it throw the synthetic `DiagnosticError`. The e2e spec
 * (`tests/e2e/observability/error-sink.spec.ts`) proves the thrown error reaches the sink on the built app.
 */
import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/diag/error/route";
import { DIAG_SYNTHETIC, DiagnosticError } from "@/lib/observability/diag-error";
import { scrubMessage } from "@/lib/observability/scrub";

const SECRET = `diag-${randomBytes(16).toString("hex")}`;

function call(authorization?: string): Promise<Response> {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return POST(new NextRequest("http://127.0.0.1:3100/api/diag/error", { method: "POST", headers }));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/diag/error", () => {
  it.each(["true", "false"])("answers 401 without the right bearer (flag %s)", async (flag) => {
    vi.stubEnv("DIAG_ERROR_ROUTE_ENABLED", flag);
    vi.stubEnv("CRON_SECRET", undefined);
    expect((await call(`Bearer ${SECRET}`)).status).toBe(401);
    expect((await call("Bearer undefined")).status).toBe(401);
    vi.stubEnv("CRON_SECRET", SECRET);
    expect((await call()).status).toBe(401);
    expect((await call(`Bearer ${SECRET}x`)).status).toBe(401);
    expect((await call(SECRET)).status).toBe(401);
    expect((await call(`bearer ${SECRET}`)).status).toBe(401);
  });

  it("answers 404 with an empty body when the flag is off or unset (the right bearer)", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    for (const flag of ["false", undefined]) {
      vi.stubEnv("DIAG_ERROR_ROUTE_ENABLED", flag);
      const res = await call(`Bearer ${SECRET}`);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("");
    }
  });

  it("throws the synthetic DiagnosticError when the flag is on (the right bearer)", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.stubEnv("DIAG_ERROR_ROUTE_ENABLED", "true");
    await expect(call(`Bearer ${SECRET}`)).rejects.toBeInstanceOf(DiagnosticError);
  });

  it("the synthetic error carries only values the scrubber removes", () => {
    const scrubbed = scrubMessage(new DiagnosticError());
    for (const value of Object.values(DIAG_SYNTHETIC)) expect(scrubbed).not.toContain(value);
    expect(scrubbed).not.toMatch(/\d{5,}/);
  });
});
