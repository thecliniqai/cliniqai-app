/**
 * V2-06 06-04a step 3: the route error boundary's classifier (lib/errors/client-error-kind.ts), which 06-06's skew guard
 * reuses, and the route pattern the boundary reports (lib/errors/client-route.ts).
 */
import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";
import { describe, expect, it } from "vitest";
import { clientErrorKind } from "@/lib/errors/client-error-kind";
import { routePatternOf } from "@/lib/errors/client-route";

describe("clientErrorKind", () => {
  it("offline wins over everything when the browser reports no network", () => {
    expect(clientErrorKind(new Error("x"), false)).toBe("offline");
    expect(clientErrorKind(new UnrecognizedActionError("gone"), false)).toBe("offline");
  });

  it("an error built by Next's own unrecognized-action constructor is skew", () => {
    expect(clientErrorKind(new UnrecognizedActionError("Server Action was not found"), true)).toBe("skew");
  });

  it("a failed chunk load (name ChunkLoadError, as webpack and Turbopack throw it) is skew", () => {
    const err = Object.assign(new Error("Failed to load chunk /_next/static/chunks/x.js"), { name: "ChunkLoadError" });
    expect(clientErrorKind(err, true)).toBe("skew");
  });

  it("a plain Error, a non-Error value and an error that only mentions a chunk are other", () => {
    expect(clientErrorKind(new Error("boom"), true)).toBe("other");
    expect(clientErrorKind("thrown string", true)).toBe("other");
    expect(clientErrorKind(null, true)).toBe("other");
    expect(clientErrorKind(new Error("ChunkLoadError"), true)).toBe("other");
  });

  it("defaults to online outside a browser (no navigator)", () => {
    expect(typeof navigator === "undefined" || navigator.onLine !== false).toBe(true);
    expect(clientErrorKind(new Error("boom"))).toBe("other");
  });
});

describe("routePatternOf", () => {
  const ID = "0b0e4c1a-2d3e-4f50-8a6b-7c8d9e0f1a2b";

  it("replaces each segment equal to a parameter's value with [name]", () => {
    expect(routePatternOf(`/patients/${ID}`, { id: ID })).toBe("/patients/[id]");
    expect(routePatternOf(`/consultation/${ID}`, { id: ID })).toBe("/consultation/[id]");
  });

  it("keeps static paths and the root", () => {
    expect(routePatternOf("/diag/client-error", {})).toBe("/diag/client-error");
    expect(routePatternOf("/", {})).toBe("/");
  });

  it("matches an encoded segment against its decoded parameter value", () => {
    expect(routePatternOf("/r/a%20b", { token: "a b" })).toBe("/r/[token]");
  });

  it("writes a catch-all once", () => {
    expect(routePatternOf("/docs/a/b/c", { slug: ["a", "b", "c"] })).toBe("/docs/[...slug]");
  });

  it("falls back to / without a usable pathname", () => {
    expect(routePatternOf(null, {})).toBe("/");
    expect(routePatternOf("relative/path", {})).toBe("/");
  });
});
