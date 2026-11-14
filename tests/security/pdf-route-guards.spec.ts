/**
 * PDF route guards (V2-01 F1, F3). The prescription and receipt PDF routes authenticate from the session, require
 * the same permission as their in-app equivalents (`prescriptions:view` for prescriptions since V2-05 05-02b, the
 * prescriptions RLS key; `appointments:view` for receipts) and accept only a UUID where the id reaches a PostgREST filter string.
 *
 * Runs on the local stack: `createClient()` from `@/lib/supabase/server` is replaced by a seeded user's own JWT
 * client, so `getActiveMembership()` resolves through the real `auth.getUser()` and memberships RLS.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { seedTenantWithOwner, addMemberToTenant, type SeededTenant } from "../helpers/tenants";

const mockState = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockState.client,
}));

import { GET as getPrescriptionPdf } from "@/app/api/visits/[id]/prescription-pdf/route";
import { GET as getReceiptPdf } from "@/app/api/invoices/[id]/receipt-pdf/route";

const MISSING_ID = "6f1c2d3e-4b5a-4c6d-8e7f-90a1b2c3d4e5";

function call(handler: typeof getPrescriptionPdf, id: string) {
  return handler(new Request(`http://localhost/api/x/${id}`), { params: Promise.resolve({ id }) });
}

describe("PDF route guards (F1, F3)", () => {
  let owner: SeededTenant;
  let receptionist: SeededTenant;
  let nurse: SeededTenant;
  let doctor: SeededTenant;

  beforeAll(async () => {
    owner = await seedTenantWithOwner("PDF Guard Clinic");
    receptionist = await addMemberToTenant(owner.tenantId, "receptionist");
    nurse = await addMemberToTenant(owner.tenantId, "nurse");
    doctor = await addMemberToTenant(owner.tenantId, "doctor");
  });

  it("rejects an unauthenticated caller on both routes with 401", async () => {
    mockState.client = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    expect((await call(getPrescriptionPdf, MISSING_ID)).status).toBe(401);
    expect((await call(getReceiptPdf, MISSING_ID)).status).toBe(401);
  });

  it("refuses the prescription PDF to a role without prescriptions:view (receptionist, nurse → 403)", async () => {
    mockState.client = receptionist.client;
    expect((await call(getPrescriptionPdf, MISSING_ID)).status).toBe(403);
    // A nurse reads consultations but not prescriptions (PO-3, matrix.ts; RLS would hide the Rx anyway).
    mockState.client = nurse.client;
    expect((await call(getPrescriptionPdf, MISSING_ID)).status).toBe(403);
  });

  it("lets a role with prescriptions:view past the gate (doctor → 404 for a missing visit, not 403)", async () => {
    mockState.client = doctor.client;
    expect((await call(getPrescriptionPdf, MISSING_ID)).status).toBe(404);
  });

  it("lets every clinic role with appointments:view reach the receipt lookup (receptionist → 404 for a missing invoice)", async () => {
    mockState.client = receptionist.client;
    expect((await call(getReceiptPdf, MISSING_ID)).status).toBe(404);
  });

  it("answers 404 for a receipt id that is not a UUID, including a filter-injection attempt", async () => {
    mockState.client = owner.client;
    expect((await call(getReceiptPdf, "not-a-uuid")).status).toBe(404);
    expect((await call(getReceiptPdf, `${MISSING_ID},id.not.is.null`)).status).toBe(404);
  });
});
