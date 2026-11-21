/**
 * V2-08 08-06a (S-1, S-2, S-3, S-8; migration 000106): the front-desk tables are written by the commands, not through PostgREST.
 * Through the user's own supabase-js client (the request path): a receptionist, nurse, doctor and owner cannot insert a visit or a
 * patient, cannot insert or update a waitlist entry, and cannot rewrite `visits.metadata` outside the AI provenance of an open
 * draft; the commands that own those writes still work. The reviewer's reproductions are the first case of each group.
 * Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { getAdminClient } from "../helpers/supabase-admin";
import { createVisit } from "../helpers/seed-visit";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { callWalkIn, callRegisterAndBook, registerAndBookArgs, seedPatient, walkInArgs } from "../helpers/front-desk-commands";
import { addToWaitlistArgs, callAddToWaitlist } from "../helpers/scheduling-commands";

const admin = getAdminClient();
let owner: SeededTenant;
let doctor: SeededTenant;
let nurse: SeededTenant;
let receptionist: SeededTenant;
let patientId: string;

const members = () => ({ receptionist, nurse, doctor, owner });

beforeAll(async () => {
  owner = await seedTenantWithOwner("Synthetic Direct Writes Clinic");
  doctor = await addMemberToTenant(owner.tenantId, "doctor");
  nurse = await addMemberToTenant(owner.tenantId, "nurse");
  receptionist = await addMemberToTenant(owner.tenantId, "receptionist");
  patientId = await seedPatient(owner);
}, 60_000);

const openVisit = async (status: string) => {
  const res = await createVisit(owner, { patient_id: patientId, doctor_id: doctor.userId, origin_type: "walk_in", status });
  if (!res.success) throw new Error(res.error);
  return res.visitId;
};

describe("S-1: no member inserts a visit", () => {
  it.each(["receptionist", "nurse", "doctor", "owner"] as const)("%s: a direct insert is refused (42501) and writes nothing", async (role) => {
    const who = members()[role];
    const reason = `direct-${randomUUID()}`;
    const { data, error } = await who.client
      .from("visits")
      .insert({
        tenant_id: owner.tenantId,
        patient_id: patientId,
        doctor_id: doctor.userId,
        origin_type: "walk_in",
        status: "completed",
        reason_for_visit: reason,
        created_by: who.userId,
      })
      .select("id");
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
    const { data: rows } = await admin.from("visits").select("id").eq("reason_for_visit", reason);
    expect(rows ?? []).toEqual([]);
  });

  it("the commands still create visits: the walk-in and the booking, with their visit.create audit row", async () => {
    const walkIn = await callWalkIn(receptionist.client, walkInArgs(receptionist, { p_patient_id: patientId, p_doctor_id: doctor.userId }));
    expect(walkIn.error).toBeNull();
    const visitId = (walkIn.data as { visit_id: string }).visit_id;
    const { data: audit } = await admin.from("audit_logs").select("actor_id, actor_role").eq("action", "visit.create").eq("entity_id", visitId);
    expect(audit).toEqual([{ actor_id: receptionist.userId, actor_role: "receptionist" }]);

    const booked = await callRegisterAndBook(
      receptionist.client,
      registerAndBookArgs(receptionist, new Date(Date.now() + 40 * 86_400_000).toISOString(), {
        p_patient_id: patientId,
        p_doctor_id: doctor.userId,
        p_overbook: true,
      })
    );
    expect(booked.error).toBeNull();
  });
});

describe("S-2: no member writes the waitlist directly", () => {
  const date = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);

  it("insert: refused for a receptionist even with another user's name as the creator (forged attribution)", async () => {
    const { data, error } = await receptionist.client
      .from("waitlist_entries")
      .insert({ tenant_id: owner.tenantId, patient_id: patientId, target_date: date, created_by: owner.userId })
      .select("id");
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("update: refused (re-opening a promoted entry, rewriting created_by)", async () => {
    const added = await callAddToWaitlist(receptionist.client, addToWaitlistArgs(receptionist, patientId, date));
    expect(added.error).toBeNull();
    const entryId = (added.data as { entry_id: string }).entry_id;
    const { data, error } = await receptionist.client
      .from("waitlist_entries")
      .update({ status: "waiting", created_by: owner.userId })
      .eq("id", entryId)
      .select("id");
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
    const { data: row } = await admin.from("waitlist_entries").select("created_by").eq("id", entryId).single();
    expect(row?.created_by).toBe(receptionist.userId);
    // The read path stays.
    const read = await receptionist.client.from("waitlist_entries").select("id").eq("id", entryId);
    expect(read.error).toBeNull();
    expect(read.data).toHaveLength(1);
  });
});

describe("S-8: no member inserts a patient", () => {
  it.each(["receptionist", "owner"] as const)("%s: a direct insert is refused (42501)", async (role) => {
    const who = members()[role];
    const name = `Synthetic Direct ${randomUUID().slice(0, 8)}`;
    const { data, error } = await who.client
      .from("patients")
      .insert({ tenant_id: owner.tenantId, full_name: name, phone: "9000001234", created_by: who.userId })
      .select("id");
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
    const { data: rows } = await admin.from("patients").select("id").eq("full_name", name);
    expect(rows ?? []).toEqual([]);
  });

  it("register_patient is the path: the phone is normalised, which a direct insert would have skipped", async () => {
    const name = `Synthetic Registered ${randomUUID().slice(0, 8)}`;
    const { data, error } = await receptionist.client.rpc("register_patient", {
      p_tenant_id: owner.tenantId,
      p_patient: { full_name: name, phone: "9000001235", age: 30 },
      p_client_request_id: randomUUID(),
    } as never);
    expect(error).toBeNull();
    const { data: row } = await admin.from("patients").select("phone").eq("id", (data as { patient_id: string }).patient_id).single();
    expect(row?.phone).toBe("+919000001235");
  });

  it("UPDATE of demographics stays (the profile edit)", async () => {
    const { error } = await receptionist.client.from("patients").update({ full_name: "Synthetic Renamed Patient" }).eq("id", patientId);
    expect(error).toBeNull();
  });
});

describe("S-3: visits.metadata is the AI provenance of an open draft, nothing else", () => {
  const setMetadata = (who: SeededTenant, visitId: string, metadata: Record<string, unknown>) =>
    who.client.from("visits").update({ metadata: metadata as never }).eq("id", visitId).select("id");
  const metadataOf = async (visitId: string) => (await admin.from("visits").select("metadata").eq("id", visitId).single()).data?.metadata;

  it("a receptionist cannot forge the confirmation keys or write a free-text cancellation reason", async () => {
    const visitId = await openVisit("waiting");
    const forged = await setMetadata(receptionist, visitId, {
      patient_confirmed: true,
      confirmed_by: doctor.userId,
      cancellation_reason: "call 9000000000",
    });
    expect(forged.data).toBeNull();
    expect(forged.error?.message).toContain("VISIT_METADATA_FORBIDDEN");
    expect(await metadataOf(visitId)).toEqual({});
  });

  it("a receptionist cannot pad the object to 200 KB, nor rewrite a signed, completed visit's provenance", async () => {
    const open = await openVisit("in_consultation");
    const padded = await setMetadata(receptionist, open, { pad: "x".repeat(200_000) });
    expect(padded.error?.message).toContain("VISIT_METADATA_FORBIDDEN");

    // A signed, completed visit that carries provenance. The system path can no longer sign an existing visit (V2-09a 000107, R-5), so it is
    // inserted already signed (R-4c), with its metadata.
    const { data: signedRow, error: signedErr } = await admin
      .from("visits")
      .insert({
        tenant_id: owner.tenantId,
        patient_id: patientId,
        doctor_id: doctor.userId,
        origin_type: "walk_in",
        status: "completed",
        signed_at: new Date().toISOString(),
        signed_by: doctor.userId,
        created_by: owner.userId,
        metadata: { ai_assisted: true, ai_sections_used: ["advice"] },
      })
      .select("id")
      .single();
    if (signedErr || !signedRow) throw new Error(`seed of the signed visit failed: ${signedErr?.message}`);
    const signed = signedRow.id as string;
    const forged = await setMetadata(receptionist, signed, { ai_assisted: false });
    expect(forged.error?.message).toContain("VISIT_METADATA_FORBIDDEN");
    const byDoctor = await setMetadata(doctor, signed, { ai_assisted: false });
    expect(byDoctor.error?.message).toContain("VISIT_METADATA_FORBIDDEN");
    expect(await metadataOf(signed)).toEqual({ ai_assisted: true, ai_sections_used: ["advice"] });
  });

  it("the doctor's draft save still writes the AI provenance of an open consultation, merged with the existing keys", async () => {
    const visitId = await openVisit("in_consultation");
    await admin.from("visits").update({ metadata: { patient_confirmed: true } }).eq("id", visitId);
    const saved = await setMetadata(doctor, visitId, { patient_confirmed: true, ai_assisted: true, ai_sections_used: ["chief_complaints", "advice"] });
    expect(saved.error).toBeNull();
    expect(await metadataOf(visitId)).toEqual({ patient_confirmed: true, ai_assisted: true, ai_sections_used: ["chief_complaints", "advice"] });
    // ... but a changed value of another key, or the wrong type of a provenance key, is refused.
    expect((await setMetadata(doctor, visitId, { patient_confirmed: false, ai_assisted: true })).error?.message).toContain("VISIT_METADATA_FORBIDDEN");
    expect((await setMetadata(doctor, visitId, { patient_confirmed: true, ai_assisted: "yes" })).error?.message).toContain("VISIT_METADATA_FORBIDDEN");
  });
});
