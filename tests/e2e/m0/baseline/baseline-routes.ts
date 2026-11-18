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

/**
 * The key screen of each characterisation flow (walk-in drawer, booking drawer, Sign & Bill modal, checkout drawer),
 * opened without submitting anything. Captured by the M0 baseline and by the V2-06 neutral capture (06-01a).
 */
export const FLOW_SCREENS: Array<{ name: string; role: E2eRole; open: (page: Page) => Promise<void> }> = [
  {
    name: "flow-walk-in-drawer",
    role: "receptionist",
    open: async (page) => {
      await page.goto("/queue");
      await page.getByRole("button", { name: "+ Add Walk-In" }).click();
      await expect(page.getByRole("heading", { name: "Quick Walk-In Registration" })).toBeVisible();
    },
  },
  {
    name: "flow-booking-drawer",
    role: "receptionist",
    open: async (page) => {
      await page.goto("/calendar");
      await page.getByRole("button", { name: "+ Book Appointment" }).click();
      await expect(page.getByRole("dialog", { name: "Schedule Appointment" })).toBeVisible();
    },
  },
  {
    name: "flow-sign-and-bill-modal",
    role: "doctor",
    open: async (page) => {
      await page.goto(`/consultation/${readRunData().tenantA.visitId}`);
      await page.getByRole("button", { name: /Complete & Sign/ }).first().click();
      await expect(page.getByRole("dialog", { name: "Complete & Sign Consultation" })).toBeVisible();
    },
  },
  {
    name: "flow-checkout-drawer",
    role: "receptionist",
    open: async (page) => {
      await page.goto("/queue");
      await page
        .getByRole("heading", { name: readRunData().tenantA.patientName, exact: true })
        .locator("xpath=ancestor::div[contains(@class,'rounded-2xl')][1]")
        .getByRole("button", { name: /Checkout/ })
        .click();
      await expect(page.getByRole("heading", { name: "Patient Checkout & Billing" })).toBeVisible();
    },
  },
];
