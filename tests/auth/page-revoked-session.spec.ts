/**
 * Dashboard pages and a session that is gone (V2-05 05-11c; root cause in the 05-02a record "Open items", wave notes
 * 05-02a/orchestrator), as amended by V2-09d (request speed).
 *
 * 05-11c: a page loader that met "no session" let `getActiveMembership()`'s "Unauthenticated" escape, and `onRequestError`
 * logged `request.error` and ingested an error-sink event for every such page load. Every dashboard page answers it with
 * `redirect("/login")` (`withPageAuth`, lib/auth/page.ts); no other error.
 *
 * V2-09d: page loaders read the session from the verified JWT claims (`getClaims()`, no Supabase Auth round trip), so a
 * session revoked at GoTrue elsewhere (sign-out on another device, password reset or change) whose access token is still
 * unexpired is no longer refused by the page itself. What ends it: the shell's `/api/session-status` (on every full load,
 * on resume and every 5 min) asks Auth fresh and answers 401, and the device signs out (`hardSignOut`); the proxy refuses it
 * once the token expires (900 s) and the refresh fails. An access token cannot be revoked before it expires at the database
 * either (AUTH_REDESIGN principle 5): data stays protected by RLS membership, not by the session check.
 *
 * - no session at all: every page redirects to /login, never an error;
 * - revoked session: no page throws "Unauthenticated" (no false request error), and `/api/session-status` answers 401.
 * Real sessions on the local stack; synthetic data only.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const mockState = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/server")>();
  return { ...actual, createClient: async () => mockState.client };
});

import TodayPage from "@/app/(dashboard)/today/page";
import PatientsPage from "@/app/(dashboard)/patients/(list)/page";
import PatientDetailPage from "@/app/(dashboard)/patients/[id]/page";
import SchedulePage from "@/app/(dashboard)/schedule/page";
import VisitsPage from "@/app/(dashboard)/visits/page";
import ReferralsPage from "@/app/(dashboard)/referrals/page";
import ProfilePage from "@/app/(dashboard)/profile/page";
import StaffPage from "@/app/(dashboard)/staff/page";
import ClinicSettingsPage from "@/app/(dashboard)/settings/clinic/page";
import ConsultationPage from "@/app/(dashboard)/consultation/[id]/page";
import { GET as sessionStatus } from "@/app/api/session-status/route";
import { anonClient } from "../security/guard/engine";
import { getAdminClient } from "../helpers/supabase-admin";
import { seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";

const ID = "00000000-0000-4000-8000-0000000000c9";
const props = { params: Promise.resolve({ id: ID }), searchParams: Promise.resolve({}) };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PAGES: Array<[string, (p: any) => Promise<unknown>]> = [
  ["/today", TodayPage],
  ["/patients", PatientsPage],
  ["/patients/[id]", PatientDetailPage],
  ["/schedule", SchedulePage],
  ["/visits", VisitsPage],
  ["/referrals", ReferralsPage],
  ["/profile", ProfilePage],
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

describe("dashboard pages and a missing or revoked session (05-11c, V2-09d)", () => {
  let owner: SeededTenant;

  beforeAll(async () => {
    owner = await seedTenantWithOwner(`Synthetic Revoked Session ${randomUUID().slice(0, 6)}`);
    const { data } = await owner.client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("no session");
    const { error } = await getAdminClient().auth.admin.signOut(token, "global");
    if (error) throw new Error(`revoke failed: ${error.status}`);
  });

  it("precondition: the client still holds its access token, and GoTrue refuses it (the revoked-session case)", async () => {
    const { data: session } = await owner.client.auth.getSession();
    expect(session.session?.access_token).toBeTruthy();
    const { data, error } = await owner.client.auth.getUser();
    expect(data.user).toBeNull();
    expect(error).not.toBeNull();
  });

  it.each(PAGES)("no session: %s → redirect('/login'), not an error", async (_route, page) => {
    mockState.client = anonClient();
    const outcome = await page(props).then(
      () => ({ rendered: true as const }),
      (err: unknown) => ({ rendered: false as const, err })
    );
    expect(outcome.rendered).toBe(false);
    const err = (outcome as { err: unknown }).err;
    expect(err instanceof Error ? err.message : String(err)).not.toBe("Unauthenticated");
    expect(redirectTarget(err)).toBe("/login");
  });

  it.each(PAGES)("revoked session: %s never throws 'Unauthenticated' (no false request error)", async (_route, page) => {
    mockState.client = owner.client;
    const err = await page(props).then(
      () => null,
      (e: unknown) => e
    );
    expect(err instanceof Error ? err.message : String(err ?? "")).not.toBe("Unauthenticated");
    // Whatever the page answers, it is a page answer (rendered, or Next's redirect / not-found), never a server error.
    const digest = (err as { digest?: unknown } | null)?.digest;
    if (err !== null) expect(typeof digest === "string" && /^NEXT_(REDIRECT|HTTP_ERROR_FALLBACK)/.test(digest)).toBe(true);
  });

  it("revoked session: the shell's status check asks Auth fresh and answers 401, so the device signs out", async () => {
    mockState.client = owner.client;
    const res = await sessionStatus();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });
});
