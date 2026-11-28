/**
 * V2-09e 09E-02 (R-20): the route patterns a `request.timing` line may carry are generated from `app/` and stay equal to it
 * (`lib/observability/server-routes.ts`), and a concrete request path maps to one of them or to the unmatched route, so an id or a
 * token in a path can never reach a line.
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { SERVER_ROUTE_PATTERNS } from "@/lib/observability/server-routes";
import { isKnownRoutePattern, routePatternOfPath, UNMATCHED_ROUTE } from "@/lib/observability/route-patterns";
import { renderModule, serverRoutePatterns } from "../../scripts/observability/server-routes.mjs";

const ID = "0b0e4c1a-2d3e-4f50-8a6b-7c8d9e0f1a2b";

describe("server route patterns", () => {
  it("equal the patterns of every page and route handler under app/ (the committed file is up to date)", () => {
    expect([...SERVER_ROUTE_PATTERNS]).toEqual(serverRoutePatterns());
    expect(fs.readFileSync("lib/observability/server-routes.ts", "utf8")).toBe(renderModule(serverRoutePatterns()));
  });

  it("maps a concrete path to its pattern and never keeps an id or a token", () => {
    expect(routePatternOfPath("/")).toBe("/");
    expect(routePatternOfPath("/today")).toBe("/today");
    expect(routePatternOfPath(`/patients/${ID}`)).toBe("/patients/[id]");
    expect(routePatternOfPath(`/consultation/${ID}`)).toBe("/consultation/[id]");
    expect(routePatternOfPath("/api/patients/search")).toBe("/api/patients/search");
    expect(routePatternOfPath(`/api/patients/${ID}/export`)).toBe("/api/patients/[id]/export");
    expect(routePatternOfPath("/r/Zm9vYmFyMTIzNDU2Nzg5MA")).toBe("/r/[token]");
    expect(routePatternOfPath("/api/v1/visits/anything")).toBe("/api/v1/visits/[id]");
    expect(routePatternOfPath("/api/terminology/diagnoses/")).toBe("/api/terminology/diagnoses");
  });

  it("answers the unmatched route for a path the app does not have, with no part of the path", () => {
    for (const path of ["/nope", `/patients/${ID}/secret-extra/segment`, "/api/919000000001", "/..%2f..%2fetc"]) {
      const pattern = routePatternOfPath(path);
      expect(pattern).toBe(UNMATCHED_ROUTE);
    }
  });

  it("a static segment wins over a dynamic one", () => {
    expect(routePatternOfPath("/billing/locked/staff")).toBe("/billing/locked/staff");
    expect(routePatternOfPath("/billing/locked")).toBe("/billing/locked");
  });

  it("only known patterns are accepted back from a header", () => {
    expect(isKnownRoutePattern("/patients/[id]")).toBe(true);
    expect(isKnownRoutePattern(UNMATCHED_ROUTE)).toBe(true);
    expect(isKnownRoutePattern(`/patients/${ID}`)).toBe(false);
    expect(isKnownRoutePattern("/patients/[id]?x=1")).toBe(false);
    expect(isKnownRoutePattern(undefined)).toBe(false);
  });
});
