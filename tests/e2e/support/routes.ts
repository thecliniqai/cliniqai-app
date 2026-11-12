/**
 * Dashboard route enumeration from the filesystem (V2-02 plans 02-03a/02-03b): every `app/(dashboard)/** /page.tsx`,
 * route groups and parallel-route slots dropped, so a new dashboard page is covered without editing the specs that
 * use it (the unauthenticated-access sweep, the M0 baseline screenshots and axe reports).
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./app-env";

export const DASHBOARD_DIR = path.join(ROOT, "app", "(dashboard)");

export interface DashboardRoute {
  /** Route pattern as written in the filesystem, e.g. `/patients/[id]`. */
  pattern: string;
  /** Concrete URL with dynamic segments filled. */
  url: string;
}

/** Fills one dynamic segment (`[id]`) of `pattern`. */
export type SegmentFiller = (pattern: string, segment: string) => string;

export function dashboardRoutes(fill: SegmentFiller, dir = DASHBOARD_DIR, segments: string[] = []): DashboardRoute[] {
  const routes: DashboardRoute[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      routes.push(...dashboardRoutes(fill, path.join(dir, entry.name), [...segments, entry.name]));
    } else if (entry.name === "page.tsx") {
      const visible = segments.filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith("@"));
      const pattern = `/${visible.join("/")}`;
      routes.push({
        pattern,
        url: `/${visible.map((s) => (/^\[.*\]$/.test(s) ? fill(pattern, s) : s)).join("/")}`,
      });
    }
  }
  return routes.sort((a, b) => a.pattern.localeCompare(b.pattern));
}

/** A file-name-safe slug for a route pattern (`/` → `home`, `/patients/[id]` → `patients-id`). */
export function routeSlug(pattern: string): string {
  const slug = pattern.replace(/[[\]]/g, "").replace(/^\/+/, "").replace(/\//g, "-");
  return slug || "home";
}
