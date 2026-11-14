/**
 * V2-06 06-04a step 2 (R-3; T-06-09, T-06-10) and 06-09a M-ERRCAP, C L-1, C L-2: what a client render error report may
 * store (lib/observability/client-render-event.ts). The name is kept only when it is a listed class name and the route
 * only when it is one of the dashboard's own route patterns (generated from app/(dashboard)/); everything else becomes
 * `client.Error` / `/`. The message and frames are always empty. The client keyspace is bounded by the app, not by the
 * caller, so any number of server instances cannot use up the database's shared daily fingerprint cap.
 *
 * The adversarial review C reproductions (scratchpad advC/probe.ts, probe2.ts) are the "reviewer reproductions" cases;
 * on 06-04a's module they store the PHI-shaped strings and reach 500 distinct fingerprints.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  admitClientReport,
  buildClientRenderEvent,
  CLIENT_ERROR_NAMES,
  CLIENT_KEYS_PER_DAY,
  CLIENT_KEYSPACE,
  CLIENT_REPEAT_WINDOW_MS,
  clientErrorName,
  clientRoutePattern,
  resetClientKeyState,
} from "@/lib/observability/client-render-event";
import { CLIENT_ROUTE_PATTERNS } from "@/lib/observability/client-routes";

const META = { environment: "test", release: null } as const;
/** `ops.error_sink_daily_cap()` (000028): new fingerprints per day, shared by server and client events. */
const DB_DAILY_FINGERPRINT_CAP = 500;

afterEach(() => resetClientKeyState());

describe("clientErrorName", () => {
  it("keeps a listed class name, prefixed with client.", () => {
    for (const name of CLIENT_ERROR_NAMES) expect(clientErrorName(name)).toBe(`client.${name}`);
    expect(clientErrorName("DiagClientRenderError")).toBe("client.DiagClientRenderError");
    expect(clientErrorName("TypeError")).toBe("client.TypeError");
  });

  it.each([
    ["an identifier-shaped name", "Error123456"],
    ["an email", "someone@example.com"],
    ["spaces", "Name with spaces"],
    ["an empty string", ""],
    ["a non-string", 42],
    ["a well-formed but unlisted class name", "ZodError"],
    ["a near miss (case)", "typeerror"],
  ])("stores %s as client.Error", (_label, name) => {
    expect(clientErrorName(name)).toBe("client.Error");
  });
});

describe("clientRoutePattern", () => {
  it("keeps every dashboard route pattern and /", () => {
    for (const route of CLIENT_ROUTE_PATTERNS) expect(clientRoutePattern(route)).toBe(route);
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
    ["a well-formed pattern that is not a dashboard route", "/patients/[id]/edit"],
    ["a public page", "/login"],
    ["a trailing slash", "/patients/"],
  ])("replaces %s with /", (_label, route) => {
    expect(clientRoutePattern(route)).toBe("/");
  });
});

describe("reviewer reproductions (adversarial review C, M-1 and M-2)", () => {
  it.each([
    ["Ravi_Kumar_ph_98765-43210", "/patients/[Ravi_Kumar_98765_43210]"],
    ["Asha.Rao.diabetes.HIV", "/patients/asha-rao/hiv-positive/(ph-98765-43210)"],
    ["aadhaar-1234-5678-9012", "/[x4f3a9c2e8b7d6a5f4e3d2c1b0a9f8e7d]"],
    ["tok_aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW", "/reset/@slot/[eyJhbGciOiJIUzI1NiJ9]"],
    ["Pat.ravi.example.com", "/r/a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"],
    ["Asha.Rao.F.52.HbA1c-9.8", "/patients/asha-rao/hiv-positive"],
  ])("M-2: free text in name %j / route %j is never stored", (name, route) => {
    const event = buildClientRenderEvent({ name, route }, META);
    expect(event.error_name).toBe("client.Error");
    expect(event.route_path).toBe("/");
  });

  it("M-1: 10 instance lifetimes × 60 made-up names reach the sink as ONE fingerprint, not 500", () => {
    const fingerprints = new Set<string>();
    for (let instance = 0; instance < 10; instance++) {
      resetClientKeyState();
      for (let i = 0; i < 60; i++) {
        const name = `Junk${instance}x${i}`.replace(/\d/g, (d) => "abcdefghij"[Number(d)]!);
        const event = buildClientRenderEvent({ name, route: "/" }, META);
        if (["new", "repeat"].includes(admitClientReport(event, 0))) fingerprints.add(`${event.route_path}|${event.error_name}`);
      }
    }
    expect([...fingerprints]).toEqual(["/|client.Error"]);
  });

  it("M-1: the whole client keyspace is a bounded share of the database's daily fingerprint cap (≤ 40 %)", () => {
    expect(CLIENT_KEYSPACE).toBe(CLIENT_ERROR_NAMES.length * (CLIENT_ROUTE_PATTERNS.length + (CLIENT_ROUTE_PATTERNS.includes("/") ? 0 : 1)));
    expect(CLIENT_KEYSPACE).toBeLessThanOrEqual(DB_DAILY_FINGERPRINT_CAP * 0.4);
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
    expect(buildClientRenderEvent({ name: "Error", route: "/" }, { ...META, release: "abcdef1" }).release).toBe("abcdef1");
    expect(buildClientRenderEvent({ name: "Error", route: "/" }, { ...META, release: "not a sha" }).release).toBeNull();
  });
});

describe("admitClientReport", () => {
  /** CLIENT_KEYS_PER_DAY + 2 distinct listed keys (name × route). */
  const keys = CLIENT_ROUTE_PATTERNS.flatMap((route) => CLIENT_ERROR_NAMES.map((name) => ({ name, route })));
  const event = (i: number) => buildClientRenderEvent(keys[i]!, META);
  const NOW = Date.UTC(2026, 10, 14, 12);

  it("has enough distinct listed keys to exercise the cap", () => {
    expect(keys.length).toBeGreaterThan(CLIENT_KEYS_PER_DAY + 2);
  });

  it(`admits at most ${CLIENT_KEYS_PER_DAY} distinct keys per day; the first refusal is reported once (C L-2), later ones silently`, () => {
    for (let i = 0; i < CLIENT_KEYS_PER_DAY; i++) expect(admitClientReport(event(i), NOW)).toBe("new");
    expect(admitClientReport(event(CLIENT_KEYS_PER_DAY), NOW)).toBe("cap-reached");
    expect(admitClientReport(event(CLIENT_KEYS_PER_DAY + 1), NOW)).toBe("dropped");
    expect(admitClientReport(event(CLIENT_KEYS_PER_DAY), NOW)).toBe("dropped");
  });

  it("C L-1: a repeat within a minute is debounced (no log, no write); after the window it counts again", () => {
    expect(admitClientReport(event(0), NOW)).toBe("new");
    expect(admitClientReport(event(0), NOW + 1)).toBe("debounced");
    expect(admitClientReport(event(0), NOW + CLIENT_REPEAT_WINDOW_MS - 1)).toBe("debounced");
    expect(admitClientReport(event(0), NOW + CLIENT_REPEAT_WINDOW_MS)).toBe("repeat");
    expect(admitClientReport(event(0), NOW + CLIENT_REPEAT_WINDOW_MS + 1)).toBe("debounced");
  });

  it("starts over on the next UTC day (cap and its report)", () => {
    for (let i = 0; i <= CLIENT_KEYS_PER_DAY; i++) admitClientReport(event(i), NOW);
    expect(admitClientReport(event(CLIENT_KEYS_PER_DAY + 1), NOW)).toBe("dropped");
    expect(admitClientReport(event(CLIENT_KEYS_PER_DAY + 1), NOW + 86_400_000)).toBe("new");
  });
});
