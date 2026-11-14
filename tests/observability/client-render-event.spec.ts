/**
 * V2-06 06-04a step 2 (R-3; T-06-09, T-06-10): what a client render error report may store
 * (lib/observability/client-render-event.ts). The name keeps only a class-name shape, the route only a pattern, and the
 * message and frames are always empty. Clients get a bounded share of the sink per instance and day.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  admitClientKey,
  buildClientRenderEvent,
  CLIENT_KEYS_PER_DAY,
  clientErrorName,
  clientRoutePattern,
  resetClientKeyState,
} from "@/lib/observability/client-render-event";

const META = { environment: "test", release: null } as const;

afterEach(() => resetClientKeyState());

describe("clientErrorName", () => {
  it("prefixes a class name with client.", () => {
    expect(clientErrorName("DiagClientRenderError")).toBe("client.DiagClientRenderError");
    expect(clientErrorName("TypeError")).toBe("client.TypeError");
  });

  it("replaces identifier-shaped or malformed names with client.Error", () => {
    expect(clientErrorName("Error123456")).toBe("client.Error");
    expect(clientErrorName("someone@example.com")).toBe("client.Error");
    expect(clientErrorName("Name with spaces")).toBe("client.Error");
    expect(clientErrorName("")).toBe("client.Error");
    expect(clientErrorName(42)).toBe("client.Error");
  });

  it("never stores a name longer than the database keeps (80)", () => {
    expect(clientErrorName("A".repeat(73))).toBe(`client.${"A".repeat(73)}`);
    expect(clientErrorName("A".repeat(74))).toBe("client.Error");
  });
});

describe("clientRoutePattern", () => {
  it("keeps a route pattern", () => {
    expect(clientRoutePattern("/diag/client-error")).toBe("/diag/client-error");
    expect(clientRoutePattern("/patients/[id]")).toBe("/patients/[id]");
    expect(clientRoutePattern("/")).toBe("/");
  });

  it.each([
    ["a UUID segment", "/patients/0b0e4c1a-2d3e-4f50-8a6b-7c8d9e0f1a2b"],
    ["a 6+ digit segment", "/x/1234567"],
    ["an @ segment", "/x/@slot"],
    ["an email segment", "/x/a@example.com"],
    ["a query string", "/patients?phone=9000000000"],
    ["a fragment", "/patients#top"],
    ["a relative path", "patients"],
    ["a non-string", 12],
  ])("replaces %s with /", (_label, route) => {
    expect(clientRoutePattern(route)).toBe("/");
  });
});

describe("buildClientRenderEvent", () => {
  it("builds the closed event: render type, no message, frames, method, digest or request id", () => {
    expect(buildClientRenderEvent({ name: "DiagClientRenderError", route: "/diag/client-error" }, META)).toEqual({
      environment: "test",
      release: null,
      route_path: "/diag/client-error",
      route_type: "render",
      method: null,
      error_name: "client.DiagClientRenderError",
      error_code: null,
      digest: null,
      message: "",
      frames: [],
      request_id: null,
    });
  });

  it("keeps a commit-shaped release and drops anything else", () => {
    expect(buildClientRenderEvent({ name: "E", route: "/" }, { ...META, release: "abcdef1" }).release).toBe("abcdef1");
    expect(buildClientRenderEvent({ name: "E", route: "/" }, { ...META, release: "not a sha" }).release).toBeNull();
  });
});

describe("admitClientKey", () => {
  const event = (i: number) => buildClientRenderEvent({ name: `SpecError${i}`, route: "/queue" }, META);
  const NOW = Date.UTC(2026, 10, 14, 12);

  it(`admits at most ${CLIENT_KEYS_PER_DAY} distinct keys per day; repeats of admitted keys still pass`, () => {
    for (let i = 0; i < CLIENT_KEYS_PER_DAY; i++) expect(admitClientKey(event(i), NOW)).toBe(true);
    expect(admitClientKey(event(CLIENT_KEYS_PER_DAY), NOW)).toBe(false);
    expect(admitClientKey(event(0), NOW)).toBe(true);
  });

  it("starts over on the next UTC day", () => {
    for (let i = 0; i <= CLIENT_KEYS_PER_DAY; i++) admitClientKey(event(i), NOW);
    expect(admitClientKey(event(CLIENT_KEYS_PER_DAY + 1), NOW)).toBe(false);
    expect(admitClientKey(event(CLIENT_KEYS_PER_DAY + 1), NOW + 86_400_000)).toBe(true);
  });
});
