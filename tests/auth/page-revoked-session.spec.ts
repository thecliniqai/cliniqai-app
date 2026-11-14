/**
 * Dashboard pages loaded with a session revoked elsewhere redirect to sign-in instead of throwing "Unauthenticated"
 * (V2-05 05-11c; root cause in the 05-02a record "Open items", wave notes 05-02a/orchestrator).
 *
 * A session revoked at GoTrue (sign-out on another device, password reset or change) still carries a valid access
 * token, so `proxy.ts` (local JWT check) lets the request through; the page's loader then asks GoTrue, gets no user and
 * `getActiveMembership()` throws. Before, pages without their own handling (patients, visits, staff, referrals,
 * profile, clinic settings; patient detail answered 404) let it escape, and `onRequestError` logged `request.error`
 * and ingested an error-sink event for every such page load. Now every dashboard page answers it with
 * `redirect("/login")` (`withPageAuth`, lib/auth/page.ts); no other error.
 *
 * Real revoked session on the local stack: an owner signs in, the session is revoked with the admin API (global
 * sign-out), and each page's server component runs with that client as `createClient()` of `@/lib/supabase/server`.
 * Synthetic data only.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const mockState = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return { ...actual, createClient: async () => mockState.client };
});

import DashboardPage from "@/app/(dashboard)/page";
import PatientsPage from "@/app/(dashboard)/patients/page";
import PatientDetailPage from "@/app/(dashboard)/patients/[id]/page";
import CalendarPage from "@/app/(dashboard)/calendar/page";
import VisitsPage from "@/app/(dashboard)/visits/page";
import ReferralsPage from "@/app/(dashboard)/referrals/page";
import CabinPage from "@/app/(dashboard)/cabin/page";
import ProfilePage from "@/app/(dashboard)/profile/page";
import QueuePage from "@/app/(dashboard)/queue/page";
import StaffPage from "@/app/(dashboard)/staff/page";
import ClinicSettingsPage from "@/app/(dashboard)/settings/clinic/page";
import ConsultationPage from "@/app/(dashboard)/consultation/[id]/page";
import { getAdminClient } from "../helpers/supabase-admin";
import { seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";

const ID = "00000000-0000-4000-8000-0000000000c9";
const props = { params: Promise.resolve({ id: ID }), searchParams: Promise.resolve({}) };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PAGES: Array<[string, (p: any) => Promise<unknown>]> = [
  ["/", DashboardPage],
  ["/patients", PatientsPage],
  ["/patients/[id]", PatientDetailPage],
  ["/calendar", CalendarPage],
  ["/visits", VisitsPage],
  ["/referrals", ReferralsPage],
  ["/cabin", CabinPage],
  ["/profile", ProfilePage],
  ["/queue", QueuePage],
  ["/staff", StaffPage],
  ["/settings/clinic", ClinicSettingsPage],
  ["/consultation/[id]", ConsultationPage],
];

/** Next's redirect is a thrown control-flow error whose digest names the target. */
function redirectTarget(err: unknown): string | null {
  const digest = (err as { digest?: unknown } | null)?.digest;
  if (typeof digest !== "string" || !digest.startsWith("NEXT_REDIRECT;")) return null;
  return digest.split(";")[2] ?? null;
}

describe("dashboard pages with a revoked session redirect to /login (05-11c)", () => {
  let owner: SeededTenant;

  beforeAll(async () => {
    owner = await seedTenantWithOwner(`Synthetic Revoked Session ${randomUUID().slice(0, 6)}`);
    const { data } = await owner.client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("no session");
    const { error } = await getAdminClient().auth.admin.signOut(token, "global");
    if (error) throw new Error(`revoke failed: ${error.status}`);
    mockState.client = owner.client;
  });

  it("precondition: the client still holds its access token, and GoTrue refuses it (the revoked-session case)", async () => {
    const { data: session } = await owner.client.auth.getSession();
    expect(session.session?.access_token).toBeTruthy();
    const { data, error } = await owner.client.auth.getUser();
    expect(data.user).toBeNull();
    expect(error).not.toBeNull();
  });

  it.each(PAGES)("%s → redirect('/login'), not an error", async (_route, page) => {
    const outcome = await page(props).then(
      () => ({ rendered: true as const }),
      (err: unknown) => ({ rendered: false as const, err })
    );
    expect(outcome.rendered).toBe(false);
    const err = (outcome as { err: unknown }).err;
    expect(err instanceof Error ? err.message : String(err)).not.toBe("Unauthenticated");
    expect(redirectTarget(err)).toBe("/login");
  });
});
