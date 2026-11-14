/**
 * `PUT /api/v1/patients/:id` cannot change a patient's allergies or chronic conditions (V2-05 05a re-verification N-6;
 * plan 05-11d; rulings R-8, R-9). In the app, changing those fields needs `consultations:view`
 * (`patients_clinical_fields_guard`), which admins do not hold; API keys are minted by admins, and the v1 route writes
 * with the system client, where that guard does not run. Before 05-11d the key wrote both fields (an allergy changed
 * silently). Now a body that carries either field is refused with 403 CLINICAL_ACCESS_DENIED before anything is read
 * or written, and demographics still update. Local stack; `/api/v1` switched on for this file. Synthetic data only.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { PUT as putPatient } from "@/app/api/v1/patients/[id]/route";
import { createApiKeySecret } from "@/lib/api/auth";
import { enableApiV1ForFile } from "../helpers/api-v1";
import { getAdminClient } from "../helpers/supabase-admin";
import { seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";

enableApiV1ForFile();

describe("/api/v1/patients/:id PUT carries no clinical fields (05-11d, N-6)", () => {
  const admin = getAdminClient();
  let owner: SeededTenant;
  let rawKey: string;
  let patientId: string;

  beforeAll(async () => {
    owner = await seedTenantWithOwner("Synthetic No Clinical Patient API Clinic");
    const secret = createApiKeySecret();
    const { error: keyErr } = await admin.from("api_keys").insert({
      tenant_id: owner.tenantId,
      name: "Synthetic no-clinical patient key",
      key_prefix: secret.keyPrefix,
      key_hash: secret.keyHash,
      created_by: owner.userId,
    });
    if (keyErr) throw new Error(`Failed to seed the API key: ${keyErr.code}`);
    rawKey = secret.rawToken;
    const { data: patient, error: pErr } = await admin
      .from("patients")
      .insert({
        tenant_id: owner.tenantId,
        full_name: "Synthetic Clinical Fields Patient",
        phone: "+919000008815",
        created_by: owner.userId,
        allergies: ["Synthetic penicillin"],
        chronic_conditions: ["Synthetic asthma"],
      })
      .select("id")
      .single();
    if (pErr || !patient) throw new Error(`Failed to seed the patient: ${pErr?.code}`);
    patientId = patient.id;
  });

  function put(body: unknown): Promise<Response> {
    const request = new NextRequest(`http://localhost:3000/api/v1/patients/${patientId}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${rawKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return putPatient(request, { params: Promise.resolve({ id: patientId }) });
  }

  async function patientRow() {
    const { data, error } = await admin
      .from("patients")
      .select("full_name, allergies, chronic_conditions, updated_at")
      .eq("id", patientId)
      .single();
    if (error || !data) throw new Error(`Failed to read the patient: ${error?.code}`);
    return data;
  }

  async function auditCount(): Promise<number> {
    const { count } = await admin
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("entity_id", patientId)
      .eq("action", "patient.update");
    return count ?? 0;
  }

  it.each([
    ["allergies", { allergies: [] }],
    ["chronic_conditions", { chronic_conditions: ["Synthetic diabetes"] }],
    ["allergies set to null", { allergies: null }],
    ["a clinical field next to a demographic change", { full_name: "Synthetic Renamed", allergies: ["Synthetic sulfa"] }],
  ])("PUT with %s → 403 CLINICAL_ACCESS_DENIED, nothing written, no audit row", async (_name, body) => {
    const before = await patientRow();
    const auditsBefore = await auditCount();
    const res = await put(body);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error.code).toBe("CLINICAL_ACCESS_DENIED");
    expect(JSON.stringify(json)).not.toContain("Synthetic");
    expect(await patientRow()).toEqual(before);
    expect(await auditCount()).toBe(auditsBefore);
  });

  it("PUT with demographics only → 200; allergies and chronic conditions are untouched", async () => {
    const res = await put({ full_name: "Synthetic Renamed Patient" });
    expect(res.status).toBe(200);
    const after = await patientRow();
    expect(after.full_name).toBe("Synthetic Renamed Patient");
    expect(after.allergies).toEqual(["Synthetic penicillin"]);
    expect(after.chronic_conditions).toEqual(["Synthetic asthma"]);
  });
});
