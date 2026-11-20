/**
 * V2-05 05-10b (SUB-02 UX, SUB §7.2 item 3): the layout redirects and the locked/onboarding pages, against the local
 * stack with real sessions and real access levels (no mocked level).
 *
 * - `lib/auth/access-redirect.ts`: the role × level table (the contract V2-06 06-06's `/api/session-status` returns).
 * - `(dashboard)/layout.tsx`: owner/admin of a locked clinic → `/billing/locked`; nurse/receptionist/doctor →
 *   `/billing/locked/staff`; any member of an onboarding (`incomplete`) clinic → `/onboarding/billing`; a `full`
 *   clinic renders.
 * - Every wrapped dashboard page loaded by a locked member redirects to the member's locked page (`withPageAuth`, for
 *   client navigations where the layout does not run). Since 05-12 (ACC L-4, IND I-7) the wrapper checks the access
 *   level before the loader runs, so no page renders an empty shell any more (before: `/`, `/patients`, `/visits`,
 *   `/consultation/[id]` and `/staff` rendered with empty reads); none throws `TenantLockedError` as a server error.
 * - The three destination pages render only for their own members and redirect everyone else to the right page
 *   (a `full` clinic → `/`), so the rule never loops.
 *
 * The page server components run with the seeded user's client as `createClient()` (the 05-11c pattern). Synthetic
 * data only.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { UserRole } from "@/lib/db/types";
import { en } from "@/messages/en";

const mockState = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return { ...actual, createClient: async () => mockState.client };
});

import DashboardLayout from "@/app/(dashboard)/layout";
import DashboardPage from "@/app/(dashboard)/(today)/page";
import PatientsPage from "@/app/(dashboard)/patients/(list)/page";
import PatientDetailPage from "@/app/(dashboard)/patients/[id]/page";
import CalendarPage from "@/app/(dashboard)/calendar/page";
import VisitsPage from "@/app/(dashboard)/visits/page";
import ReferralsPage from "@/app/(dashboard)/referrals/page";
import CabinPage from "@/app/(dashboard)/cabin/page";
import ProfilePage from "@/app/(dashboard)/profile/page";
import QueuePage from "@/app/(dashboard)/queue/page";
import StaffPage from "@/app/(dashboard)/staff/page";
import ClinicSettingsPage from "@/app/(dashboard)/settings/clinic/page";
import BillingSettingsPage from "@/app/(dashboard)/settings/billing/page";
import DeveloperSettingsPage from "@/app/(dashboard)/settings/developer/page";
import BillingReportsPage from "@/app/(dashboard)/billing/reports/page";
import ConsultationPage from "@/app/(dashboard)/consultation/[id]/page";
import LockedOwnerPage from "@/app/billing/locked/page";
import LockedStaffPage from "@/app/billing/locked/staff/page";
import OnboardingBillingPage from "@/app/(onboarding)/onboarding/billing/page";
import {
  ACCESS_DESTINATIONS,
  accessRedirect,
  LOCKED_OWNER_PATH,
  LOCKED_STAFF_PATH,
  ONBOARDING_BILLING_PATH,
} from "@/lib/auth/access-redirect";
import type { TenantAccessLevel } from "@/lib/auth/tenant";
import type { TestDb } from "../helpers/db";
import { getAdminClient } from "../helpers/supabase-admin";
import { seedAccessFixtureClinic, seedTenantWithOwner, signInSeededUser } from "../helpers/tenants";

const ROLES: UserRole[] = ["owner", "admin", "doctor", "nurse", "receptionist"];

/** Next's redirect is a thrown control-flow error whose digest names the target. */
function redirectTarget(err: unknown): string | null {
  const digest = (err as { digest?: unknown } | null)?.digest;
  if (typeof digest !== "string" || !digest.startsWith("NEXT_REDIRECT;")) return null;
  return digest.split(";")[2] ?? null;
}

type Outcome =
  | { kind: "rendered" }
  | { kind: "redirect"; to: string }
  | { kind: "notFound" }
  | { kind: "error"; name: string; message: string };

async function run(fn: () => Promise<unknown>): Promise<Outcome> {
  try {
    await fn();
    return { kind: "rendered" };
  } catch (err) {
    const to = redirectTarget(err);
    if (to !== null) return { kind: "redirect", to };
    const digest = (err as { digest?: unknown } | null)?.digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;404")) return { kind: "notFound" };
    return {
      kind: "error",
      name: err instanceof Error ? err.name : typeof err,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

describe("accessRedirect: role × access level → destination (05-10b contract)", () => {
  const expected: Record<TenantAccessLevel, (role: UserRole) => string | null> = {
    full: () => null,
    onboarding: () => ONBOARDING_BILLING_PATH,
    locked: (role) => (role === "owner" || role === "admin" ? LOCKED_OWNER_PATH : LOCKED_STAFF_PATH),
    // Purged or unreadable: fail closed, as locked.
    none: (role) => (role === "owner" || role === "admin" ? LOCKED_OWNER_PATH : LOCKED_STAFF_PATH),
  };
  for (const level of ["full", "locked", "onboarding", "none"] as const) {
    it.each(ROLES)(`${level} × %s`, (role) => {
      expect(accessRedirect(role, level)).toBe(expected[level](role));
    });
  }

  it("every destination is outside the (dashboard) group and maps to itself for its members (no loop)", () => {
    expect([...ACCESS_DESTINATIONS].sort()).toEqual(["/billing/locked", "/billing/locked/staff", "/onboarding/billing"]);
    expect(accessRedirect("owner", "locked")).toBe(LOCKED_OWNER_PATH);
    expect(accessRedirect("receptionist", "locked")).toBe(LOCKED_STAFF_PATH);
    expect(accessRedirect("receptionist", "onboarding")).toBe(ONBOARDING_BILLING_PATH);
  });

  // V2-05 05-12 (CTO, 2026-11-15): the copy members read names no internal phase, requirement or ruling id.
  it("no text of the locked and onboarding pages names an internal id (V2-…, AUTH-…, SUB-…, PO-…, R-…)", () => {
    const texts: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === "string") texts.push(v);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(en.subscription);
    expect(texts.length).toBeGreaterThan(10);
    expect(texts.filter((t) => /\b(V2-\d|AUTH-\d|SUB-\d|PO-\d|R-\d)/.test(t))).toEqual([]);
  });
});

describe("locked and onboarding clinics: layout redirects, page loaders, destination pages (local stack)", () => {
  const clients = {} as Record<"lockedOwner" | "lockedAdmin" | "lockedDoctor" | "lockedNurse" | "lockedReceptionist" | "onboardingOwner" | "onboardingReceptionist" | "fullOwner", TestDb>;
  let lockedPatientId = "";
  let lockedVisitId = "";

  beforeAll(async () => {
    const tag = randomUUID().slice(0, 6);
    const locked = await seedAccessFixtureClinic("locked", `Synthetic Locked Clinic ${tag}`, ROLES);
    const onboarding = await seedAccessFixtureClinic("onboarding", `Synthetic Onboarding Clinic ${tag}`, ["owner", "receptionist"]);
    const full = await seedTenantWithOwner(`Synthetic Full Clinic ${tag}`);

    const byRole = (role: UserRole) => locked.users.find((u) => u.role === role)!;
    clients.lockedOwner = await signInSeededUser(byRole("owner").email);
    clients.lockedAdmin = await signInSeededUser(byRole("admin").email);
    clients.lockedDoctor = await signInSeededUser(byRole("doctor").email);
    clients.lockedNurse = await signInSeededUser(byRole("nurse").email);
    clients.lockedReceptionist = await signInSeededUser(byRole("receptionist").email);
    clients.onboardingOwner = await signInSeededUser(onboarding.users[0].email);
    clients.onboardingReceptionist = await signInSeededUser(onboarding.users[1].email);
    clients.fullOwner = full.client;

    // A real patient and visit of the locked clinic, so the deep-link pages ask for rows that exist.
    const admin = getAdminClient();
    const { data: patient, error: pErr } = await admin
      .from("patients")
      .insert({ tenant_id: locked.tenantId, full_name: `Synthetic Locked Patient ${tag}`, phone: `+9190000${10000 + Math.floor(Math.random() * 89999)}`, sex: "other", created_by: byRole("owner").userId })
      .select("id")
      .single();
    if (pErr || !patient) throw new Error(`patient seed failed: ${pErr?.code}`);
    lockedPatientId = patient.id;
    const { data: visit, error: vErr } = await admin
      .from("visits")
      .insert({
        tenant_id: locked.tenantId,
        patient_id: patient.id,
        doctor_id: byRole("doctor").userId,
        origin_type: "walk_in",
        status: "in_consultation",
        estimated_duration_minutes: 15,
        created_by: byRole("owner").userId,
      })
      .select("id")
      .single();
    if (vErr || !visit) throw new Error(`visit seed failed: ${vErr?.code}`);
    lockedVisitId = visit.id;
  });

  const as = (who: keyof typeof clients) => {
    mockState.client = clients[who];
  };
  const layout = () => DashboardLayout({ children: null });

  describe("(dashboard) layout", () => {
    it.each([
      ["lockedOwner", LOCKED_OWNER_PATH],
      ["lockedAdmin", LOCKED_OWNER_PATH],
      ["lockedDoctor", LOCKED_STAFF_PATH],
      ["lockedNurse", LOCKED_STAFF_PATH],
      ["lockedReceptionist", LOCKED_STAFF_PATH],
      ["onboardingOwner", ONBOARDING_BILLING_PATH],
      ["onboardingReceptionist", ONBOARDING_BILLING_PATH],
    ] as const)("%s → redirect(%s)", async (who, to) => {
      as(who);
      expect(await run(layout)).toEqual({ kind: "redirect", to });
    });

    it("a full clinic's owner renders the dashboard (no redirect)", async () => {
      as("fullOwner");
      expect(await run(layout)).toEqual({ kind: "rendered" });
    });
  });

  describe("dashboard page loaders of a locked clinic (client navigation: the layout does not run)", () => {
    const pages = (): Array<[string, () => Promise<unknown>]> => {
      const idProps = (id: string) => ({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });
      const none = { params: Promise.resolve({}), searchParams: Promise.resolve({}) };
      return [
        ["/", () => DashboardPage(none as never)],
        ["/patients", () => PatientsPage(none as never)],
        ["/patients/[id]", () => PatientDetailPage(idProps(lockedPatientId) as never)],
        ["/calendar", () => CalendarPage(none as never)],
        ["/visits", () => VisitsPage(none as never)],
        ["/referrals", () => ReferralsPage(none as never)],
        ["/cabin", () => CabinPage(none as never)],
        ["/profile", () => ProfilePage(none as never)],
        ["/queue", () => QueuePage(none as never)],
        ["/staff", () => StaffPage(none as never)],
        ["/settings/clinic", () => ClinicSettingsPage(none as never)],
        ["/settings/billing", () => BillingSettingsPage(none as never)],
        ["/settings/developer", () => DeveloperSettingsPage(none as never)],
        ["/billing/reports", () => BillingReportsPage(none as never)],
        ["/consultation/[id]", () => ConsultationPage(idProps(lockedVisitId) as never)],
      ];
    };

    for (const [who, destination] of [
      ["lockedOwner", LOCKED_OWNER_PATH],
      ["lockedReceptionist", LOCKED_STAFF_PATH],
      ["lockedDoctor", LOCKED_STAFF_PATH],
    ] as const) {
      it(`${who}: every page redirects to ${destination} before its loader runs; none renders or throws`, async () => {
        as(who);
        const outcomes: Record<string, Outcome> = {};
        for (const [route, page] of pages()) outcomes[route] = await run(page);
        const notRedirected = Object.entries(outcomes).filter(([, o]) => !(o.kind === "redirect" && o.to === destination));
        expect(notRedirected, JSON.stringify(outcomes)).toEqual([]);
      });
    }
  });

  describe("destination pages render only for their own members", () => {
    it.each([
      // [who, page, expected]
      ["lockedOwner", "locked", { kind: "rendered" }],
      ["lockedAdmin", "locked", { kind: "rendered" }],
      ["lockedReceptionist", "locked", { kind: "redirect", to: LOCKED_STAFF_PATH }],
      ["lockedReceptionist", "staff", { kind: "rendered" }],
      ["lockedNurse", "staff", { kind: "rendered" }],
      ["lockedOwner", "staff", { kind: "redirect", to: LOCKED_OWNER_PATH }],
      ["lockedOwner", "onboarding", { kind: "redirect", to: LOCKED_OWNER_PATH }],
      ["onboardingOwner", "onboarding", { kind: "rendered" }],
      ["onboardingReceptionist", "onboarding", { kind: "rendered" }],
      ["onboardingOwner", "locked", { kind: "redirect", to: ONBOARDING_BILLING_PATH }],
      ["onboardingReceptionist", "staff", { kind: "redirect", to: ONBOARDING_BILLING_PATH }],
      ["fullOwner", "locked", { kind: "redirect", to: "/" }],
      ["fullOwner", "staff", { kind: "redirect", to: "/" }],
      ["fullOwner", "onboarding", { kind: "redirect", to: "/" }],
    ] as const)("%s on the %s page → %o", async (who, pageName, expected) => {
      as(who);
      const page = { locked: LockedOwnerPage, staff: LockedStaffPage, onboarding: OnboardingBillingPage }[pageName];
      expect(await run(() => page())).toEqual(expected);
    });

    it("the owner's locked page shows the clinic, status and end date, and the staff page no subscription detail", async () => {
      as("lockedOwner");
      const ownerTree = JSON.stringify(await LockedOwnerPage());
      expect(ownerTree).toContain("Synthetic Locked Clinic");
      expect(ownerTree).toContain("Expired");
      expect(ownerTree).toContain("Your clinic's data is safe. Nothing has been deleted.");
      expect(ownerTree).toContain("Renewal and data export will open on this page soon.");
      expect(ownerTree).not.toContain("Not available"); // the end date is known (access ended 30 days ago)

      as("lockedReceptionist");
      const staffTree = JSON.stringify(await LockedStaffPage());
      expect(staffTree).toContain("Your clinic's subscription is inactive; contact the owner.");
      expect(staffTree).toContain("Synthetic Locked Clinic");
      expect(staffTree).not.toContain("Expired");
    });
  });
});
