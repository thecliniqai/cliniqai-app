/**
 * The routes the M0 baseline captures (V2-02 plan 02-03b; FRONTEND_MIGRATION_PLAN M0 "baseline metrics"): every
 * dashboard page (enumerated from the filesystem) plus the three public auth pages, each with the role that views it
 * and, for dynamic segments, the run's seeded tenant-A record. Synthetic data only.
 */
import type { Page } from "@playwright/test";
import { expect } from "../../fixtures";
import { dashboardRoutes, routeSlug } from "../../support/routes";
import { readRunData, type E2eRole } from "../../support/run-data";

export interface BaselineRoute {
  pattern: string;
  slug: string;
  /** Signed-in role, or null for a signed-out (public) page. */
  role: E2eRole | null;
  /** The concrete URL; resolved at test time (the run data exists only after global setup). */
  url: () => string;
}

/** Doctor-facing screens are captured as the doctor; everything else as the owner (who can open every page). */
const DOCTOR_ROUTES = new Set(["/cabin", "/consultation/[id]"]);

function fillSegment(pattern: string): string {
  const { tenantA } = readRunData();
  if (pattern.startsWith("/consultation/")) return tenantA.visitId;
  if (pattern.startsWith("/patients/")) return tenantA.patientId;
  throw new Error(`M0 baseline: no seeded record for the dynamic route ${pattern}; add one in baseline-routes.ts`);
}

const AUTH_ROUTES: BaselineRoute[] = ["/login", "/forgot-password"].map((pattern) => ({
  pattern,
  slug: routeSlug(pattern),
  role: null,
  url: () => pattern,
}));

export const BASELINE_ROUTES: BaselineRoute[] = [
  ...AUTH_ROUTES,
  ...dashboardRoutes(() => "__segment__").map((route) => ({
    pattern: route.pattern,
    slug: routeSlug(route.pattern),
    role: (DOCTOR_ROUTES.has(route.pattern) ? "doctor" : "owner") as E2eRole,
    url: () => dashboardRoutes((pattern) => fillSegment(pattern)).find((r) => r.pattern === route.pattern)!.url,
  })),
];

/** Waits until a captured page has settled: loaded, its main landmark (or the auth card) visible, network quiet. */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("load");
  await expect(page.locator("main, h1").first()).toBeVisible();
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
}
