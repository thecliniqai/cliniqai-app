/**
 * V2-05 05-11b, INT L-5 (migration 000074): `public.log_audit` accepts only the app's own actions and metadata keys.
 *
 * 1. Parity: the SQL allow-lists (`private.audit_client_actions()`, `private.audit_metadata_keys()`) equal the app's
 *    (`AUDIT_ACTIONS` without the reserved prefixes, plus the two DPDP events log_audit binds to their operation:
 *    `dpdp.data_export` needs exports:create, `dpdp.patient_erasure` an erased patient; `AUDIT_METADATA_KEYS`
 *    without `actor_type`/`api_key_id`, which only the API-key path writes). A new action or key in the app without the
 *    migration fails here (and would fail every audited action that uses it, since a failed audit aborts the action).
 * 2. Through the user's own supabase-js client (PostgREST): a receptionist cannot plant a "completed" DPDP export or any
 *    action the app never writes, nor free-text metadata; the app's `recordAudit` still writes as the caller.
 * Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { AUDIT_ACTIONS, AUDIT_METADATA_KEYS, recordAudit } from "@/lib/audit/audit";
import { getAdminClient } from "../helpers/supabase-admin";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { ctxFor } from "../helpers/context";
import { psql } from "../helpers/sql";

const RESERVED = /^(dpdp|auth|billing|ops)\./;
const BOUND_DPDP = ["dpdp.data_export", "dpdp.patient_erasure"];
const sorted = (xs: readonly string[]) => [...xs].sort();
const admin = getAdminClient();
let owner: SeededTenant;
let receptionist: SeededTenant;

async function rowsFor(entityId: string) {
  const { data, error } = await admin
    .from("audit_logs")
    .select("actor_id, actor_role, action, metadata")
    .eq("entity_id", entityId);
  if (error) throw new Error(error.message);
  return data ?? [];
}

beforeAll(async () => {
  owner = await seedTenantWithOwner("Synthetic Audit Allow-list Clinic");
  receptionist = await addMemberToTenant(owner.tenantId, "receptionist");
});

describe("log_audit allow-lists: SQL = app", () => {
  it("the action allow-list is AUDIT_ACTIONS without the reserved prefixes, plus the two bound DPDP events", () => {
    const sql = psql("select unnest(private.audit_client_actions())");
    expect(sorted(sql)).toEqual(sorted(AUDIT_ACTIONS.filter((a) => !RESERVED.test(a) || BOUND_DPDP.includes(a))));
  });

  it("the metadata key allow-list is AUDIT_METADATA_KEYS without the API-key-only keys", () => {
    const sql = psql("select unnest(private.audit_metadata_keys())");
    expect(sorted(sql)).toEqual(sorted(AUDIT_METADATA_KEYS.filter((k) => k !== "actor_type" && k !== "api_key_id")));
  });

  it("no API role can call the list functions", () => {
    expect(
      psql(
        "select r || ':' || has_function_privilege(r, 'private.audit_client_actions()', 'EXECUTE') || ':' || " +
          "has_function_privilege(r, 'private.audit_metadata_keys()', 'EXECUTE') " +
          "from unnest(array['anon','authenticated','service_role']) r order by 1"
      )
    ).toEqual(["anon:false:false", "authenticated:false:false", "service_role:false:false"]);
  });
});

describe("log_audit through PostgREST (INT L-5)", () => {
  const call = (t: SeededTenant, action: string, entityId: string, metadata: Record<string, unknown> | null) =>
    t.client.rpc("log_audit", {
      p_tenant: owner.tenantId,
      p_action: action,
      p_entity_type: "patient",
      p_entity_id: entityId,
      p_metadata: metadata as never,
    });

  it("a receptionist cannot plant a completed DPDP export (the reviewer's row)", async () => {
    const entityId = randomUUID();
    const { error } = await call(receptionist, "dpdp.data_export", entityId, { status: "completed", format: "json" });
    expect(error).toMatchObject({ code: "42501", message: "AUDIT_ACTION_FORBIDDEN" });
    expect(await rowsFor(entityId)).toEqual([]);
  });

  it("nor an action the app never writes, nor free-text metadata", async () => {
    const entityId = randomUUID();
    const unknownAction = await call(receptionist, "patient.exported_everything", entityId, null);
    expect(unknownAction.error).toMatchObject({ code: "P0001", message: "INPUT_INVALID" });
    const freeText = await call(receptionist, "patient.view", entityId, { free_text: "Synthetic note" });
    expect(freeText.error).toMatchObject({ code: "P0001", message: "INPUT_INVALID" });
    const longValue = await call(receptionist, "patient.view", entityId, { reason: "x".repeat(501) });
    expect(longValue.error).toMatchObject({ code: "P0001", message: "INPUT_INVALID" });
    expect(await rowsFor(entityId)).toEqual([]);
  });

  it("the owner's in-app DPDP export audit (exports:create) is still written", async () => {
    const entityId = randomUUID();
    const { error } = await call(owner, "dpdp.data_export", entityId, { format: "pdf", status: "completed" });
    expect(error).toBeNull();
    expect(await rowsFor(entityId)).toEqual([
      { actor_id: owner.userId, actor_role: "owner", action: "dpdp.data_export", metadata: { format: "pdf", status: "completed" } },
    ]);
  });

  it("the app's recordAudit still writes as the caller, with filtered metadata", async () => {
    const entityId = randomUUID();
    await recordAudit(ctxFor(receptionist), {
      action: "patient.update",
      entityType: "patient",
      entityId,
      metadata: { fields_changed: ["phone"], full_name: "Synthetic Name Dropped" },
    });
    expect(await rowsFor(entityId)).toEqual([
      { actor_id: receptionist.userId, actor_role: "receptionist", action: "patient.update", metadata: { fields_changed: ["phone"] } },
    ]);
  });
});
