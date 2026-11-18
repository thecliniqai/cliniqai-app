/**
 * V2-06 06-09a M-ERRCAP: the dashboard route patterns a client render error may store
 * (lib/observability/client-routes.ts) are generated from the route tree and stay equal to it. Adding or moving a
 * dashboard page without regenerating fails here; a pattern route-error.tsx would compute for a real page is listed.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CLIENT_ROUTE_PATTERNS } from "@/lib/observability/client-routes";
import { routePatternOf } from "@/lib/errors/client-route";
import { dashboardRoutePatterns, renderModule } from "../../scripts/observability/client-routes.mjs";
import { ROOT, runChecker } from "../ci/run-checker";

describe("client route patterns", () => {
  it("equal the patterns of every page under app/(dashboard)/ (the committed file is up to date)", () => {
    expect([...CLIENT_ROUTE_PATTERNS]).toEqual(dashboardRoutePatterns());
    expect(fs.readFileSync("lib/observability/client-routes.ts", "utf8")).toBe(renderModule(dashboardRoutePatterns()));
  });

  it("include what the boundary computes for real dashboard URLs", () => {
    const id = "0b0e4c1a-2d3e-4f50-8a6b-7c8d9e0f1a2b";
    for (const [pathname, params] of [
      ["/", {}],
      [`/patients/${id}`, { id }],
      [`/consultation/${id}`, { id }],
      ["/billing/reports", {}],
      ["/diag/client-error", {}],
    ] as const) {
      expect(CLIENT_ROUTE_PATTERNS).toContain(routePatternOf(pathname, params));
    }
  });

  it("the generator drops route groups, keeps dynamic segments, skips private, parallel and intercepting folders", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "client-routes-"));
    const page = (rel: string) => {
      fs.mkdirSync(path.join(root, "app/(dashboard)", rel), { recursive: true });
      fs.writeFileSync(path.join(root, "app/(dashboard)", rel, "page.tsx"), "export default function P() { return null; }\n");
    };
    page("");
    page("(group)/inside");
    page("things/[id]");
    page("guides/[...slug]");
    page("_private/hidden");
    page("@modal/slot");
    page("(.)photo/[id]");
    expect(dashboardRoutePatterns(root)).toEqual(["/", "/guides/[...slug]", "/inside", "/things/[id]"]);
  });

  it("--check passes on the repository", () => {
    const r = runChecker(process.execPath, [path.join(ROOT, "scripts/observability/client-routes.mjs"), "--check"]);
    expect(r.status, r.stderr).toBe(0);
  });
});
