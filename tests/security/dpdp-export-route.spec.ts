/**
 * Ruling 01-09: the in-app DPDP export (components/patients/dpdp-export-actions.tsx) uses the session-authenticated
 * app route `GET /api/patients/[id]/export`, not `/api/v1` (off by default, AR2-H2). The route takes the tenant from
 * the session and requires `patients:view` (the permission `exportPatientDpdpArchive` asserts).
 *
 * Local stack: `createClient()` from `@/lib/supabase/server` is replaced by a seeded user's own JWT client (same
 * pattern as tests/security/pdf-route-guards.spec.ts), so membership and RLS resolve for real.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { ROLE_PERMISSIONS, type Permission } from "@/lib/permissions";
import { seedTenantWithOwner, addMemberToTenant, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";

const mockState = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockState.client,
}));

import { GET as exportRoute } from "@/app/api/patients/[id]/export/route";

const admin = getAdminClient();

async function seedPatient(owner: SeededTenant, label: string): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin.from("patients") as any)
    .insert({
      tenant_id: owner.tenantId,
      full_name: `Synthetic Export Patient ${label}`,
      phone: `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
      created_by: owner.userId,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seed patient failed: ${error?.message}`);
  return data.id as string;
}

function call(id: string, format = "json") {
  return exportRoute(new NextRequest(`http://localhost/api/patients/${id}/export?format=${format}`), {
    params: Promise.resolve({ id }),
  });
}

describe("DPDP export app route (session cookie, independent of /api/v1)", () => {
  let A: SeededTenant;
  let B: SeededTenant;
  let receptionist: SeededTenant;
  let patientA: string;
  let patientB: string;

  beforeAll(async () => {
    A = await seedTenantWithOwner(`Export A ${randomUUID().slice(0, 8)}`);
    B = await seedTenantWithOwner(`Export B ${randomUUID().slice(0, 8)}`);
    receptionist = await addMemberToTenant(A.tenantId, "receptionist");
    patientA = await seedPatient(A, "A");
    patientB = await seedPatient(B, "B");
  }, 60_000);

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("the owner gets the JSON and PDF archives with the v1 flag off", async () => {
    vi.stubEnv("API_V1_ENABLED", undefined);
    mockState.client = A.client;

    const res = await call(patientA);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("content-disposition")).toContain(`patient-dpdp-export-${patientA}.json`);
    const bundle = await res.json();
    expect(bundle.export_metadata.standard).toBe("DPDP_ACT_2023_RIGHT_TO_ACCESS");
    expect(bundle.export_metadata.tenant_id).toBe(A.tenantId);
    expect(bundle.patient.id).toBe(patientA);

    const pdf = await call(patientA, "pdf");
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString()).toBe("%PDF");
  }, 60_000);

  it("an unauthenticated caller gets 401", async () => {
    mockState.client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const res = await call(patientA);
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain(patientA);
  });

  it("another tenant's patient (and a non-UUID id) is a 404 with a fixed message", async () => {
    mockState.client = A.client;
    for (const id of [patientB, "not-a-uuid"]) {
      const res = await call(id);
      expect(res.status, id).toBe(404);
      const body = await res.json();
      expect(body).toEqual({ error: "Patient not found." });
    }
  });

  it("a role without patients:view gets 403 and no archive", async () => {
    // Every clinic role holds patients:view today; the permission is withdrawn from the receptionist for this case so
    // the route's own check is exercised (restored afterwards).
    const perms = ROLE_PERMISSIONS as Record<string, readonly Permission[]>;
    const original = perms.receptionist;
    perms.receptionist = original.filter((p) => p !== "patients:view");
    try {
      mockState.client = receptionist.client;
      const res = await call(patientA);
      expect(res.status).toBe(403);
      expect(await res.text()).not.toContain(patientA);
    } finally {
      perms.receptionist = original;
    }
    mockState.client = receptionist.client;
    expect((await call(patientA)).status).toBe(200);
  });
});
