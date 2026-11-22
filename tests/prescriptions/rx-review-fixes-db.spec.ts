/**
 * V2-09c 09C-06a (migration 000120; 09C-REVIEW-SEC S-2, S-8; 09C-REVIEW-A A-8; ruling R-AL). The cases that need two sessions or the app's services:
 *
 * - S-8: `change_prescription` and `repeat_visit_plan` read the patient's allergies FOR SHARE, so an allergy record in flight (FOR NO KEY UPDATE on the
 *   patient row, exactly what `record_patient_allergies` takes) holds them until it commits: with the lock held longer than the commands' 2 s lock_timeout
 *   they answer LOCK_TIMEOUT instead of checking an allergy list that is about to change.
 * - S-2 / R-AL: the patient edit sends an allergy change through `record_patient_allergies` (the command's audit row exists, the trigger's row too) and names
 *   `allergies` and `chronic_conditions` in `patient.update`'s `fields_changed`.
 * - A-8: a stale list (the edit form or the consult editor opened before someone else recorded an allergy) is refused with ALLERGIES_CHANGED and a fixed
 *   text; nothing is written, the demographics of the same edit included.
 * Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { Json } from "@/lib/db/types";
import { updatePatient } from "@/features/patients/service";
import { recordPatientAllergies, RECORD_ALLERGIES_MESSAGES } from "@/features/patients/allergies";
import { patientSchema } from "@/features/patients/schema";
import { mapDbError } from "@/lib/db/errors";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { ctxFor } from "../helpers/context";
import { getAdminClient } from "../helpers/supabase-admin";
import { auditRows } from "../helpers/billing-commands";
import { seedClinicalVisit, signVisitAs } from "../helpers/clinical-commands";
import { addRxLinesAs, rxLine } from "../helpers/rx-lines";
import { insertReturningId } from "../helpers/db";
import { psql, psqlAsync } from "../helpers/sql";

const admin = getAdminClient();
let clinic: SeededTenant;
let doctor: SeededTenant;

beforeAll(async () => {
  clinic = await seedTenantWithOwner("CI Rx Review Fixes Clinic");
  doctor = await addMemberToTenant(clinic.tenantId, "doctor");
}, 120_000);

const stored = async (id: string) => (await admin.from("patients").select("allergies, full_name, chronic_conditions").eq("id", id).single()).data;

/** A draft visit of a patient with the given allergies. */
async function draftWith(allergies: string[] | null) {
  const v = await seedClinicalVisit(clinic, { doctorId: doctor.userId, status: "in_consultation", notes: null, prescriptions: 0 });
  await admin.from("patients").update({ allergies }).eq("id", v.patientId).throwOnError();
  return v;
}

/**
 * Holds FOR NO KEY UPDATE on the patient row (what an allergy record in flight holds) for `seconds` in another session; resolves when the lock is taken.
 * `done` settles when that session commits.
 */
async function holdPatientRow(patientId: string, seconds: number): Promise<{ done: Promise<string[]> }> {
  if (!/^[0-9a-f-]{36}$/.test(patientId)) throw new Error("not a uuid");
  const marker = `rxfix_hold_${randomUUID().replace(/-/g, "")}`;
  const held = psqlAsync(
    `/* ${marker} */ begin; select 1 from public.patients where id = '${patientId}' for no key update; select pg_sleep(${seconds}); commit;`,
  );
  // The lock is taken once that session sleeps (the row lock is acquired by the statement before pg_sleep).
  for (let i = 0; i < 100; i++) {
    const [n] = psql(`select count(*) from pg_stat_activity where wait_event = 'PgSleep' and query like '%${marker}%'`);
    // Wrapped: an async function that returned the promise itself would wait for the holder to commit.
    if (n === "1") return { done: held };
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("the lock holder did not start");
}

describe("S-8: the commands read the allergies FOR SHARE", () => {
  it("change_prescription waits for an allergy record in flight and answers LOCK_TIMEOUT rather than checking a list about to change", async () => {
    const v = await draftWith(["Qzxreviewallergen"]);
    const held = await holdPatientRow(v.patientId, 4);
    const res = await doctor.client.rpc("change_prescription", {
      p_tenant_id: clinic.tenantId,
      p_visit_id: v.visitId,
      p_changes: { add: [rxLine({ medicine_name: "Qzxreview Plain 10" })] } as unknown as Json,
      p_client_request_id: randomUUID(),
    });
    await held.done;
    expect(res.error?.code).toBe("55P03");
    expect(mapDbError(res.error)).toMatchObject({ code: "CONFLICT", reason: "LOCK_TIMEOUT" });
  });

  it("repeat_visit_plan waits the same way", async () => {
    const source = await seedClinicalVisit(clinic, { doctorId: doctor.userId, status: "in_consultation", notes: "Synthetic note", prescriptions: 0 });
    await addRxLinesAs(ctxFor(doctor), source.visitId, [rxLine({ medicine_name: "Qzxreview Repeat 5" })]);
    await signVisitAs(doctor, source.visitId);
    await admin.from("patients").update({ allergies: ["Qzxreviewallergen"] }).eq("id", source.patientId).throwOnError();
    const target = await insertReturningId(admin, "visits", {
      tenant_id: clinic.tenantId,
      patient_id: source.patientId,
      doctor_id: doctor.userId,
      origin_type: "walk_in",
      status: "in_consultation",
      created_by: doctor.userId,
    });
    const held = await holdPatientRow(source.patientId, 4);
    const res = await doctor.client.rpc("repeat_visit_plan", {
      p_tenant_id: clinic.tenantId,
      p_visit_id: target,
      p_source_visit_id: source.visitId,
      p_parts: ["prescription"],
      p_client_request_id: randomUUID(),
    });
    await held.done;
    expect(res.error?.code).toBe("55P03");
  });
});

describe("S-2 / R-AL and A-8: the patient edit records allergies through the command", () => {
  const editInput = (over: Record<string, unknown>) =>
    patientSchema.parse({ full_name: "Synthetic Review Edit", phone: "9810000077", age: 40, sex: "female", chronic_conditions: [], ...over });

  it("an allergy change goes through record_patient_allergies and the audit names the changed clinical fields (names only)", async () => {
    const v = await draftWith(["Qzxreviewsulfa"]);
    const res = await updatePatient(
      ctxFor(doctor),
      v.patientId,
      editInput({ allergies: ["Qzxreviewsulfa", "Qzxreviewdust"], allergies_expected: ["Qzxreviewsulfa"], chronic_conditions: ["Synthetic chronic"] }),
    );
    expect(res.success).toBe(true);
    expect(await stored(v.patientId)).toMatchObject({ allergies: ["Qzxreviewsulfa", "Qzxreviewdust"], chronic_conditions: ["Synthetic chronic"] });
    expect(await auditRows(clinic.tenantId, "patient.allergies_record", v.patientId)).toEqual([
      expect.objectContaining({ actor_id: doctor.userId, metadata: { allergies_count: 2, coded_count: 0 } }),
    ]);
    // The trigger records every writer: the fixture's service-role write (system) and the doctor's edit (`auditRows` promises no order).
    const changes = await auditRows(clinic.tenantId, "patient.allergies_change", v.patientId);
    expect(changes).toHaveLength(2);
    expect(changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actor_id: null, actor_type: "system", metadata: { allergies_count: 1, added: 1, removed: 0 } }),
        expect.objectContaining({ actor_id: doctor.userId, actor_type: "user", metadata: { allergies_count: 2, added: 1, removed: 0 } }),
      ]),
    );
    const update = await auditRows(clinic.tenantId, "patient.update", v.patientId);
    expect(update).toHaveLength(1);
    expect((update[0].metadata as { fields_changed: string[] }).fields_changed).toEqual(expect.arrayContaining(["allergies", "chronic_conditions"]));
    expect(JSON.stringify(update[0].metadata)).not.toContain("Qzxreviewdust");
  });

  it("a stale edit form (someone recorded an allergy since it opened) is refused with the fixed text; nothing is written, not even the name", async () => {
    const v = await draftWith(["Qzxreviewsulfa", "Qzxreviewpenicillin"]);
    const before = await stored(v.patientId);
    const res = await updatePatient(
      ctxFor(doctor),
      v.patientId,
      editInput({ full_name: "Synthetic Renamed", allergies: ["Qzxreviewsulfa", "Qzxreviewdust"], allergies_expected: ["Qzxreviewsulfa"] }),
    );
    expect(res).toEqual({ success: false, error: RECORD_ALLERGIES_MESSAGES.ALLERGIES_CHANGED });
    expect(await stored(v.patientId)).toEqual(before);
    expect(await auditRows(clinic.tenantId, "patient.allergies_record", v.patientId)).toEqual([]);
  });

  it("the consult editor's service: a stale expected list is CONFLICT with the reason ALLERGIES_CHANGED and the fixed text", async () => {
    const v = await draftWith(["Qzxreviewpenicillin"]);
    const res = await recordPatientAllergies(ctxFor(doctor), {
      patient_id: v.patientId,
      allergies: ["Qzxreviewsulfa"],
      expected_allergies: null,
      client_request_id: randomUUID(),
    });
    expect(res).toMatchObject({ ok: false, error: { code: "CONFLICT", reason: "ALLERGIES_CHANGED", message: RECORD_ALLERGIES_MESSAGES.ALLERGIES_CHANGED } });
    expect((await stored(v.patientId))?.allergies).toEqual(["Qzxreviewpenicillin"]);
  });
});
