/**
 * Audit v2 with real JWTs (V2-05 05-02c; P1-04 trigger part; R-20, R-42; threat T-05-12). Through the user's own
 * supabase-js client (PostgREST) and through the app's `recordAudit`:
 *   - a direct `audit_logs` insert, honest or naming another actor, is refused and writes nothing (INSERT revoked);
 *   - `recordAudit` (now `public.log_audit`) writes one row whose actor and role are the caller's, whatever the
 *     service context claims, with the allow-listed metadata only (no patient field reaches the row);
 *   - a member of clinics A and B whose client acts in A cannot write an audit row for B; acting in B they can.
 * Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { recordAudit } from "@/lib/audit/audit";
import { getAdminClient } from "../helpers/supabase-admin";
import { addMemberToTenant, createDualMembershipUser, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { signInActingIn } from "../helpers/active-tenant";
import { ctxFor } from "../helpers/context";

const admin = getAdminClient();
let A: SeededTenant;
let B: SeededTenant;
let nurse: SeededTenant;

async function rowsFor(entityId: string) {
  const { data, error } = await admin
    .from("audit_logs")
    .select("tenant_id, actor_id, actor_role, actor_type, api_key_id, action, metadata")
    .eq("entity_id", entityId);
  if (error) throw new Error(error.message);
  return data ?? [];
}

beforeAll(async () => {
  A = await seedTenantWithOwner("Audit Actor Clinic A");
  B = await seedTenantWithOwner("Audit Actor Clinic B");
  nurse = await addMemberToTenant(A.tenantId, "nurse");
}, 60_000);

describe("audit_logs direct writes (INSERT revoked, 05-02c)", () => {
  it("a nurse inserting a row that names the owner is refused and nothing is written", async () => {
    const entityId = randomUUID();
    const { error } = await nurse.client.from("audit_logs").insert({
      tenant_id: A.tenantId,
      actor_id: A.userId,
      actor_role: "owner",
      action: "patient.update",
      entity_type: "patient",
      entity_id: entityId,
    });
    expect(error?.code).toBe("42501");
    expect(await rowsFor(entityId)).toEqual([]);
  });

  it("even an honest direct insert is refused: users write through log_audit only", async () => {
    const entityId = randomUUID();
    const { error } = await A.client.from("audit_logs").insert({
      tenant_id: A.tenantId,
      actor_id: A.userId,
      actor_role: "owner",
      action: "patient.update",
      entity_type: "patient",
      entity_id: entityId,
    });
    expect(error?.code).toBe("42501");
    expect(await rowsFor(entityId)).toEqual([]);
  });
});

describe("recordAudit through log_audit", () => {
  it("records the caller as the actor with their role, whatever the context claims, and only allow-listed metadata", async () => {
    const entityId = randomUUID();
    // A context that lies about the actor and role: the database takes both from the session.
    const lying = { ...ctxFor(nurse), userId: A.userId, role: "owner" as const };
    await recordAudit(lying, {
      action: "patient.update",
      entityType: "patient",
      entityId,
      metadata: { fields_changed: ["phone"], full_name: "Synthetic Name", phone: "+919000000999" },
    });
    expect(await rowsFor(entityId)).toEqual([
      {
        tenant_id: A.tenantId,
        actor_id: nurse.userId,
        actor_role: "nurse",
        actor_type: "user",
        api_key_id: null,
        action: "patient.update",
        metadata: { fields_changed: ["phone"] },
      },
    ]);
  });

  it("a member of A and B acting in A cannot audit for B; acting in B the row is theirs with the B role", async () => {
    const dual = await createDualMembershipUser(A.tenantId, "doctor", B.tenantId, "receptionist");
    const inA = await signInActingIn(dual.userEmail, A.tenantId);
    const inB = await signInActingIn(dual.userEmail, B.tenantId);
    const entityId = randomUUID();
    const ctxB = { userId: dual.userId, tenantId: B.tenantId, role: "receptionist" as const, actorType: "user" as const };

    await expect(recordAudit({ ...ctxB, db: inA }, { action: "patient.view", entityType: "patient", entityId })).rejects.toThrow(
      "Audit log recording failed"
    );
    expect(await rowsFor(entityId)).toEqual([]);

    await recordAudit({ ...ctxB, db: inB }, { action: "patient.view", entityType: "patient", entityId });
    expect(await rowsFor(entityId)).toMatchObject([
      { tenant_id: B.tenantId, actor_id: dual.userId, actor_role: "receptionist", actor_type: "user" },
    ]);
  });

  it("a member of A cannot audit for clinic B at all", async () => {
    const entityId = randomUUID();
    await expect(
      recordAudit({ ...ctxFor(nurse), tenantId: B.tenantId }, { action: "patient.view", entityType: "patient", entityId })
    ).rejects.toThrow("Audit log recording failed");
    expect(await rowsFor(entityId)).toEqual([]);
  });
});
