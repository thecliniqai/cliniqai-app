/**
 * V2-05 05-06 (P1-11; threat T-05-19): `exports:create` on both export paths. The `/api/v1` API-key path needs the
 * `exports:create` scope on the key (`api_keys.scopes`, migration 000062): a key without it gets 403 with a fixed body
 * and no export; with it, 200. The check sits in `exportPatientDpdpArchive`, so every API-key caller of the service is
 * covered. Before 05-06 any key of the clinic exported a full patient record.
 *
 * Local stack; `/api/v1` switched on for this file (tests/helpers/api-v1.ts). Synthetic data only.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { GET as exportRoute } from "@/app/api/v1/patients/[id]/export/route";
import { ExportScopeMissingError, exportPatientDpdpArchive } from "@/features/dpdp/export";
import { createApiKeySecret } from "@/lib/api/auth";
import { PermissionDeniedError } from "@/lib/permissions";
import { seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import { mockCtx } from "../helpers/context";
import { enableApiV1ForFile } from "../helpers/api-v1";

enableApiV1ForFile();

const admin = getAdminClient();

async function seedKey(t: SeededTenant, scopes: string[]): Promise<{ raw: string; id: string }> {
  const secret = createApiKeySecret();
  const { data, error } = await admin
    .from("api_keys")
    .insert({
      tenant_id: t.tenantId,
      name: `Synthetic export key ${randomUUID().slice(0, 6)}`,
      key_prefix: secret.keyPrefix,
      key_hash: secret.keyHash,
      created_by: t.userId,
      scopes,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seed api key failed: ${error?.code ?? "no row"}`);
  return { raw: secret.rawToken, id: data.id };
}

async function exportAs(raw: string, patientId: string, format = "json") {
  return exportRoute(
    new NextRequest(`http://localhost/api/v1/patients/${patientId}/export?format=${format}`, {
      headers: { authorization: `Bearer ${raw}` },
    }),
    { params: Promise.resolve({ id: patientId }) },
  );
}

async function exportAuditCount(tenantId: string, patientId: string): Promise<number> {
  const { count, error } = await admin
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("action", "dpdp.data_export")
    .eq("entity_id", patientId);
  if (error) throw new Error(`audit count failed: ${error.code}`);
  return count ?? 0;
}

describe("/api/v1 patient export requires the exports:create key scope (05-06)", () => {
  let A: SeededTenant;
  let B: SeededTenant;
  let patientId: string;
  let unscoped: { raw: string; id: string };
  let scoped: { raw: string; id: string };
  let scopedB: { raw: string; id: string };

  beforeAll(async () => {
    A = await seedTenantWithOwner(`Export Scope A ${randomUUID().slice(0, 8)}`);
    B = await seedTenantWithOwner(`Export Scope B ${randomUUID().slice(0, 8)}`);
    const { data, error } = await admin
      .from("patients")
      .insert({
        tenant_id: A.tenantId,
        full_name: "Synthetic Export Scope Patient",
        phone: `+9198${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        created_by: A.userId,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`seed patient failed: ${error?.code ?? "no row"}`);
    patientId = data.id;
    unscoped = await seedKey(A, []);
    scoped = await seedKey(A, ["exports:create"]);
    scopedB = await seedKey(B, ["exports:create"]);
  }, 60_000);

  it("a key without the scope gets 403 with a fixed body, for JSON and PDF, and nothing is exported or audited", async () => {
    for (const format of ["json", "pdf"]) {
      const res = await exportAs(unscoped.raw, patientId, format);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("FORBIDDEN");
      expect(body.error.message).toBe("This credential may not export patient records.");
      expect(JSON.stringify(body)).not.toContain("Synthetic Export Scope Patient");
    }
    expect(await exportAuditCount(A.tenantId, patientId)).toBe(0);
  });

  it("a key with the scope gets the archive (200) and the export is audited", async () => {
    const res = await exportAs(scoped.raw, patientId);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const json = await res.json();
    expect(json.patient.full_name).toBe("Synthetic Export Scope Patient");
    expect(json.patient).not.toHaveProperty("created_by");
    expect(await exportAuditCount(A.tenantId, patientId)).toBe(1);
  });

  it("a scoped key of another clinic still gets 404 for this clinic's patient", async () => {
    const res = await exportAs(scopedB.raw, patientId);
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });

  it("removing the scope from a key stops its exports", async () => {
    const { error } = await admin.from("api_keys").update({ scopes: [] }).eq("id", scoped.id);
    expect(error).toBeNull();
    expect((await exportAs(scoped.raw, patientId)).status).toBe(403);
  });

  it("the service refuses an API-key context whose key lacks the scope (covers every API-key caller)", async () => {
    const ctx = mockCtx(admin, { tenantId: A.tenantId, userId: A.userId, role: "admin", actorType: "api_key", apiKeyId: unscoped.id });
    const err = await exportPatientDpdpArchive(ctx, patientId, { skipAudit: true }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExportScopeMissingError);
    expect(err).toBeInstanceOf(PermissionDeniedError);
    // An API-key context without a key id is refused too.
    const noKey = mockCtx(admin, { tenantId: A.tenantId, userId: A.userId, role: "admin", actorType: "api_key" });
    await expect(exportPatientDpdpArchive(noKey, patientId, { skipAudit: true })).rejects.toBeInstanceOf(ExportScopeMissingError);
    // The key must belong to the acting clinic: A's scoped key id under B's context is refused.
    const { error } = await admin.from("api_keys").update({ scopes: ["exports:create"] }).eq("id", unscoped.id);
    expect(error).toBeNull();
    const foreign = mockCtx(admin, { tenantId: B.tenantId, userId: B.userId, role: "admin", actorType: "api_key", apiKeyId: unscoped.id });
    await expect(exportPatientDpdpArchive(foreign, patientId, { skipAudit: true })).rejects.toBeInstanceOf(ExportScopeMissingError);
  });

  it("the database refuses an unknown scope (closed set)", async () => {
    const { error } = await admin.from("api_keys").update({ scopes: ["patients:delete"] }).eq("id", unscoped.id);
    expect(error?.code).toBe("23514");
  });
});
