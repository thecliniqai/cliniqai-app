/**
 * V2-07 07-03 (R-1, R-2, R-3, R-7): `public.register_and_book`, registering a patient and booking the slot as one
 * atomic command.
 *
 * The patient (when new), the slot check in the clinic's time zone, the scheduled visit under the
 * `visits_no_double_booking` exclusion, the `appointment_booked` message (dedupe key `appointment_booked:<visit>`) and the
 * `patient.create` / `visit.create` audit rows commit together or not at all. A refused slot (SLOT_TAKEN, SLOT_OFF_DUTY,
 * SLOT_BLOCKED) leaves no orphan patient. SECURITY DEFINER; appointments:edit (+ patients:edit for a new patient).
 * Called through the caller's own client; rows are seeded and read with the service-role client. Synthetic data only.
 *
 * Every slot is in March 2031 (IST: the default clinic zone), on its own week per test, inside the default shifts of a new
 * doctor (Mon-Sat 10:00-13:00 and 17:00-21:00, 000012) unless a test says otherwise.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { mapDbError } from "@/lib/db/errors";
import { hasPerm } from "@/lib/permissions";
import type { UserRole } from "@/lib/db/types";
import { BOOKING_COMMAND_MESSAGES, registerAndBook } from "@/features/visits/scheduling-service";
import { addMemberToTenant, createDualMembershipUser, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { getAdminClient } from "../helpers/supabase-admin";
import type { TestDb } from "../helpers/db";
import { ctxFor } from "../helpers/context";
import { signInActingIn } from "../helpers/active-tenant";
import { leftoverFaults, withFault } from "../helpers/fault";
import { expectCommandCatalog } from "../helpers/command-catalog";
import { createBarrier, gateClient } from "../helpers/write-barrier";
import { psql, psqlAsync } from "../helpers/sql";
import { auditRows, commandResultRows, expectDataOnlyStoredResult } from "../helpers/billing-commands";
import {
  callRegisterAndBook,
  messagesOfVisit,
  newPatient,
  patientsMarked,
  registerAndBookArgs,
  seedBlock,
  seedBookedVisit,
  seedPatient,
  setSchedule,
  visitsOfPatient,
  weekSchedule,
} from "../helpers/front-desk-commands";

const ROLES: UserRole[] = ["owner", "admin", "doctor", "nurse", "receptionist"];

let tenantA: SeededTenant;
let tenantB: SeededTenant;
let tenantFault: SeededTenant;
let tenantNy: SeededTenant;
let docB: SeededTenant;
const members = {} as Record<UserRole, SeededTenant>;

/** The instant of IST wall-clock `h:mm` on Monday 3 Mar 2031 + `week` weeks + `dow` days. */
function ist(week: number, dow: number, h: number, mm = 0): string {
  return new Date(Date.UTC(2031, 2, 3 + week * 7 + dow, h, mm) - 330 * 60_000).toISOString();
}

const marker = () => `RB-${randomUUID().slice(0, 8)}`;

beforeAll(async () => {
  tenantA = await seedTenantWithOwner("CI Booking Clinic A");
  tenantB = await seedTenantWithOwner("CI Booking Clinic B");
  tenantFault = await seedTenantWithOwner("CI Booking Fault Clinic");
  tenantNy = await seedTenantWithOwner("CI Booking New York Clinic");
  members.owner = tenantA;
  for (const role of ROLES.filter((r) => r !== "owner")) members[role] = await addMemberToTenant(tenantA.tenantId, role);
  docB = await addMemberToTenant(tenantA.tenantId, "doctor");
  const admin = getAdminClient();
  await admin.from("memberships").update({ full_name: "Asha Rao" }).eq("tenant_id", tenantA.tenantId).eq("user_id", tenantA.userId);
  await admin.from("memberships").update({ full_name: "Dr. Meera Iyer" }).eq("tenant_id", tenantA.tenantId).eq("user_id", docB.userId);
  const { error } = await admin.from("tenants").update({ timezone: "America/New_York" }).eq("id", tenantNy.tenantId);
  if (error) throw new Error(`seed timezone failed: ${error.message}`);
});

afterAll(() => {
  expect(leftoverFaults()).toBe(0);
});

describe("register_and_book: catalog", () => {
  it("is DEFINER with the pinned settings, EXECUTE for authenticated only, and a required p_client_request_id", () => {
    expectCommandCatalog({
      signature: "public.register_and_book(uuid, uuid, jsonb, uuid, timestamptz, integer, boolean, uuid, text, boolean, boolean)",
      definer: true,
    });
  });

  it("the shared steps have no API grant", () => {
    for (const fn of [
      "private.step_create_patient(uuid, jsonb)",
      "private.slot_conflicts(uuid, uuid, timestamptz, integer, text)",
      "private.command_request_hash(jsonb)",
      "private.step_enqueue_booking_message(uuid, uuid, uuid, uuid, timestamptz, text)",
    ]) {
      expect(
        psql(`select has_function_privilege('authenticated', '${fn}', 'EXECUTE')::text || ',' || has_function_privilege('service_role', '${fn}', 'EXECUTE')::text`),
        fn
      ).toEqual(["false,false"]);
    }
  });
});

describe("register_and_book: one transaction", () => {
  it("new patient: patient, scheduled visit, booking message, two audit rows and the claim commit together", async () => {
    const m = marker();
    const at = ist(0, 0, 11, 0); // Mon 3 Mar 2031, 11:00 IST
    const args = registerAndBookArgs(tenantA, at, {
      p_new_patient: newPatient(m, { phone: "9876543210" }),
      p_duration_minutes: 20,
      p_reason: "Synthetic check-up",
    });
    const { data, error } = await callRegisterAndBook(members.receptionist.client, args);
    expect(error).toBeNull();
    const result = data as { patient_id: string; visit_id: string };
    expect(data).toMatchObject({ patient_created: true, message_enqueued: true, replayed: false });

    const [patient] = await patientsMarked(tenantA.tenantId, m);
    expect(patient).toMatchObject({ id: result.patient_id, phone: "+919876543210", created_by: members.receptionist.userId });
    const [visit] = await visitsOfPatient(patient.id);
    expect(visit).toMatchObject({
      id: result.visit_id,
      status: "booked",
      origin_type: "scheduled",
      doctor_id: tenantA.userId,
      estimated_duration_minutes: 20,
      reason_for_visit: "Synthetic check-up",
      is_overbooked: false,
      created_by: members.receptionist.userId,
    });
    expect(new Date(visit.scheduled_at as string).toISOString()).toBe(at);
    expect(visit.location_id).toBeTruthy();

    const [message] = await messagesOfVisit(visit.id);
    expect(message).toMatchObject({
      tenant_id: tenantA.tenantId,
      patient_id: patient.id,
      channel: "whatsapp",
      message_type: "appointment_booked",
      template_id: "appointment_booked",
      recipient_phone: "+919876543210",
      dedupe_key: `member:${members.receptionist.userId}:appointment_booked:${visit.id}`,
      created_by: members.receptionist.userId,
      // The clinic's zone (Asia/Kolkata): 05:30Z is 11:00 IST; the doctor's name gets its "Dr." prefix.
      template_params: { patient_name: `Synthetic ${m}`, doctor_name: "Dr. Asha Rao", date_time: "3 Mar 2031, 11:00 am" },
      metadata: { buttons: [{ id: "btn_confirm", text: "Confirm" }, { id: "btn_cancel", text: "Cancel" }, { id: "btn_reschedule", text: "Reschedule" }] },
    });

    expect(await auditRows(tenantA.tenantId, "patient.create", patient.id)).toHaveLength(1);
    expect(await auditRows(tenantA.tenantId, "visit.create", visit.id)).toEqual([
      expect.objectContaining({ actor_id: members.receptionist.userId, entity_type: "visit", metadata: expect.objectContaining({ origin_type: "scheduled" }) }),
    ]);
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual(["public.register_and_book|true"]);
    // F-5 (07-04a): the stored result holds ids, numbers, amounts, statuses and flags only, no free text.
    expectDataOnlyStoredResult(tenantA.tenantId, args.p_client_request_id);
  });

  it("existing patient: no patient is created; a doctor name that already starts with Dr. is kept", async () => {
    const patientId = await seedPatient(tenantA);
    const { data, error } = await callRegisterAndBook(
      tenantA.client,
      registerAndBookArgs(tenantA, ist(0, 1, 11), { p_patient_id: patientId, p_doctor_id: docB.userId })
    );
    expect(error).toBeNull();
    expect(data).toMatchObject({ patient_id: patientId, patient_created: false, message_enqueued: true });
    const [message] = await messagesOfVisit((data as { visit_id: string }).visit_id);
    expect(message.template_params).toMatchObject({ doctor_name: "Dr. Meera Iyer" });
    expect(await auditRows(tenantA.tenantId, "patient.create", patientId)).toEqual([]);
  });

  it("a patient without a usable mobile number is booked without a message", async () => {
    const patientId = await seedPatient(tenantA, { phone: "+910000000000" });
    const { data, error } = await callRegisterAndBook(tenantA.client, registerAndBookArgs(tenantA, ist(0, 2, 11), { p_patient_id: patientId }));
    expect(error).toBeNull();
    expect(data).toMatchObject({ message_enqueued: false });
    expect(await messagesOfVisit((data as { visit_id: string }).visit_id)).toEqual([]);
    expect(await visitsOfPatient(patientId)).toHaveLength(1);
  });

  it("the message text uses the clinic's time zone across the UTC date line (02:00 IST on 4 Mar is 20:30Z on 3 Mar)", async () => {
    const patientId = await seedPatient(tenantA);
    const at = new Date(Date.UTC(2031, 2, 3, 20, 30)).toISOString();
    const { data, error } = await callRegisterAndBook(tenantA.client, registerAndBookArgs(tenantA, at, { p_patient_id: patientId, p_overbook: true }));
    expect(error).toBeNull();
    const [message] = await messagesOfVisit((data as { visit_id: string }).visit_id);
    expect(message.template_params).toMatchObject({ date_time: "4 Mar 2031, 2:00 am" });
  });

  it("rollback: a fault on the message insert (the last write) leaves no patient, visit, message, audit row or claim", async () => {
    const m = marker();
    const args = registerAndBookArgs(tenantFault, ist(1, 0, 11), { p_new_patient: newPatient(m) });

    await withFault({ table: "public.communication_queue", column: "tenant_id", marker: tenantFault.tenantId }, async () => {
      const { data, error } = await callRegisterAndBook(tenantFault.client, args);
      expect(data).toBeNull();
      expect(error?.code).toBe("XX000");

      // Through the service: a fixed message, never the driver's text.
      const viaService = await registerAndBook(
        ctxFor(tenantFault),
        { new_patient: newPatient(m), doctor_id: tenantFault.userId, scheduled_at: ist(1, 0, 11) },
        randomUUID()
      );
      expect(viaService).toMatchObject({ ok: false, error: { code: "INTERNAL", message: BOOKING_COMMAND_MESSAGES.INTERNAL } });
      expect(JSON.stringify(viaService)).not.toContain("SPIKE_FAULT");
    });

    expect(await patientsMarked(tenantFault.tenantId, m)).toEqual([]);
    const { count: visits } = await getAdminClient().from("visits").select("id", { count: "exact", head: true }).eq("tenant_id", tenantFault.tenantId);
    expect(visits).toBe(0);
    const { count: messages } = await getAdminClient().from("communication_queue").select("id", { count: "exact", head: true }).eq("tenant_id", tenantFault.tenantId);
    expect(messages).toBe(0);
    expect(await auditRows(tenantFault.tenantId, "patient.create")).toEqual([]);
    expect(await auditRows(tenantFault.tenantId, "visit.create")).toEqual([]);
    expect(commandResultRows(tenantFault.tenantId, args.p_client_request_id)).toEqual([]);

    // The same id then succeeds, once.
    const retry = await callRegisterAndBook(tenantFault.client, args);
    expect(retry.error).toBeNull();
    expect(await patientsMarked(tenantFault.tenantId, m)).toHaveLength(1);
  });

  it("an unknown or another clinic's patient or doctor writes nothing (and registers no patient)", async () => {
    const m = marker();
    const foreignPatient = await seedPatient(tenantB);
    const unknownDoctor = await callRegisterAndBook(tenantA.client, registerAndBookArgs(tenantA, ist(1, 1, 11), { p_new_patient: newPatient(m), p_doctor_id: tenantB.userId }));
    expect(unknownDoctor.error).toMatchObject({ code: "P0002", message: "DOCTOR_NOT_FOUND" });
    const foreign = await callRegisterAndBook(tenantA.client, registerAndBookArgs(tenantA, ist(1, 1, 11), { p_patient_id: foreignPatient }));
    expect(foreign.error).toMatchObject({ code: "P0002", message: "PATIENT_NOT_FOUND" });
    expect(await patientsMarked(tenantA.tenantId, m)).toEqual([]);
    expect(await visitsOfPatient(foreignPatient)).toEqual([]);
  });
});

describe("register_and_book: the slot", () => {
  it("a taken slot is SLOT_TAKEN and registers nobody; back-to-back and another doctor are free (the slot is half-open)", async () => {
    const week = 2;
    const first = await callRegisterAndBook(tenantA.client, registerAndBookArgs(tenantA, ist(week, 0, 11, 0), { p_patient_id: await seedPatient(tenantA) }));
    expect(first.error).toBeNull();

    const m = marker();
    const clash = registerAndBookArgs(tenantA, ist(week, 0, 11, 10), { p_new_patient: newPatient(m) });
    const res = await callRegisterAndBook(tenantA.client, clash);
    expect(res.error).toMatchObject({ code: "P0001", message: "SLOT_TAKEN" });
    expect(mapDbError(res.error)).toMatchObject({ code: "CONFLICT", reason: "SLOT_TAKEN" });
    expect(await patientsMarked(tenantA.tenantId, m)).toEqual([]);
    expect(commandResultRows(tenantA.tenantId, clash.p_client_request_id)).toEqual([]);

    const backToBack = await callRegisterAndBook(tenantA.client, registerAndBookArgs(tenantA, ist(week, 0, 11, 15), { p_patient_id: await seedPatient(tenantA) }));
    expect(backToBack.error).toBeNull();
    const otherDoctor = await callRegisterAndBook(tenantA.client, registerAndBookArgs(tenantA, ist(week, 0, 11, 0), { p_patient_id: await seedPatient(tenantA), p_doctor_id: docB.userId }));
    expect(otherDoctor.error).toBeNull();
  });

  it("a cancelled, a no-show and an overbooked visit do not hold their slot", async () => {
    const week = 2;
    const patientId = await seedPatient(tenantA);
    await seedBookedVisit(tenantA, patientId, tenantA.userId, ist(week, 1, 11, 0), { status: "cancelled" });
    await seedBookedVisit(tenantA, patientId, tenantA.userId, ist(week, 1, 11, 30), { status: "no_show" });
    await seedBookedVisit(tenantA, patientId, tenantA.userId, ist(week, 1, 12, 0), { is_overbooked: true });
    for (const t of [ist(week, 1, 11, 0), ist(week, 1, 11, 30), ist(week, 1, 12, 0)]) {
      const res = await callRegisterAndBook(tenantA.client, registerAndBookArgs(tenantA, t, { p_patient_id: await seedPatient(tenantA) }));
      expect(res.error, t).toBeNull();
    }
  });

  it("an overbooking into a taken slot is stored, flagged, and skips the shift check", async () => {
    const week = 2;
    const at = ist(week, 2, 11, 0);
    expect((await callRegisterAndBook(tenantA.client, registerAndBookArgs(tenantA, at, { p_patient_id: await seedPatient(tenantA) }))).error).toBeNull();
    const over = await callRegisterAndBook(tenantA.client, registerAndBookArgs(tenantA, at, { p_patient_id: await seedPatient(tenantA), p_overbook: true }));
    expect(over.error).toBeNull();
    const [row] = await visitsOfPatient((over.data as { patient_id: string }).patient_id);
    expect(row.is_overbooked).toBe(true);

    // 03:00 IST is off duty; overbooked, the shifts are not checked (as before).
    const night = await callRegisterAndBook(tenantA.client, registerAndBookArgs(tenantA, ist(week, 2, 3, 0), { p_patient_id: await seedPatient(tenantA), p_overbook: true }));
    expect(night.error).toBeNull();
  });

  it("outside the doctor's shifts (and on a day off) is SLOT_OFF_DUTY; the override books it as an overbooking", async () => {
    const week = 2;
    for (const [dow, h, mm] of [[3, 14, 0], [3, 9, 50], [3, 12, 50], [6, 11, 0]] as const) {
      // 14:00 between the shifts; 09:50 before; 12:50 + 15 min runs past 13:00; Sunday is a day off.
      const m = marker();
      const res = await callRegisterAndBook(tenantA.client, registerAndBookArgs(tenantA, ist(week, dow, h, mm), { p_new_patient: newPatient(m) }));
      expect(res.error, `${dow} ${h}:${mm}`).toMatchObject({ code: "P0001", message: "SLOT_OFF_DUTY" });
      expect(await patientsMarked(tenantA.tenantId, m)).toEqual([]);
    }
    const m = marker();
    const forced = await callRegisterAndBook(tenantA.client, registerAndBookArgs(tenantA, ist(week, 3, 14, 0), { p_new_patient: newPatient(m), p_override_off_duty: true }));
    expect(forced.error).toBeNull();
    const [patient] = await patientsMarked(tenantA.tenantId, m);
    expect((await visitsOfPatient(patient.id))[0].is_overbooked).toBe(true);
    // The last minute of a shift is bookable: 12:45-13:00.
    expect((await callRegisterAndBook(tenantA.client, registerAndBookArgs(tenantA, ist(week, 3, 12, 45), { p_patient_id: await seedPatient(tenantA) }))).error).toBeNull();
  });

  it("a block (the doctor's or clinic-wide) is SLOT_BLOCKED; the override books into it, not flagged; another doctor is free", async () => {
    const week = 2;
    await seedBlock(tenantA, ist(week, 4, 11, 0), ist(week, 4, 12, 0), tenantA.userId);
    await seedBlock(tenantA, ist(week, 5, 11, 0), ist(week, 5, 12, 0), null);

    for (const dow of [4, 5]) {
      const m = marker();
      const res = await callRegisterAndBook(tenantA.client, registerAndBookArgs(tenantA, ist(week, dow, 11, 30), { p_new_patient: newPatient(m) }));
      expect(res.error, `day ${dow}`).toMatchObject({ code: "P0001", message: "SLOT_BLOCKED" });
      expect(mapDbError(res.error)).toMatchObject({ code: "CONFLICT", reason: "SLOT_BLOCKED" });
      expect(await patientsMarked(tenantA.tenantId, m)).toEqual([]);
    }
    // Touching the block's end is free (the block is half-open too).
    expect((await callRegisterAndBook(tenantA.client, registerAndBookArgs(tenantA, ist(week, 4, 12, 0), { p_patient_id: await seedPatient(tenantA) }))).error).toBeNull();

    const forced = await callRegisterAndBook(tenantA.client, registerAndBookArgs(tenantA, ist(week, 4, 11, 30), { p_patient_id: await seedPatient(tenantA), p_override_block: true }));
    expect(forced.error).toBeNull();
    expect((await visitsOfPatient((forced.data as { patient_id: string }).patient_id))[0].is_overbooked).toBe(false);
    // The doctor's own block does not stop another doctor; the clinic-wide one does.
    expect((await callRegisterAndBook(tenantA.client, registerAndBookArgs(tenantA, ist(week, 4, 11, 30), { p_patient_id: await seedPatient(tenantA), p_doctor_id: docB.userId }))).error).toBeNull();
    expect((await callRegisterAndBook(tenantA.client, registerAndBookArgs(tenantA, ist(week, 5, 11, 30), { p_patient_id: await seedPatient(tenantA), p_doctor_id: docB.userId }))).error).toMatchObject({
      message: "SLOT_BLOCKED",
    });
  });

  it("the shifts are read in the clinic's zone: 10:30 in New York (15:30Z) is on duty, while in IST it would be 21:00", async () => {
    const at = new Date(Date.UTC(2031, 0, 15, 15, 30)).toISOString(); // Wed 15 Jan 2031, 10:30 EST
    const res = await callRegisterAndBook(tenantNy.client, registerAndBookArgs(tenantNy, at, { p_patient_id: await seedPatient(tenantNy) }));
    expect(res.error).toBeNull();
    const [message] = await messagesOfVisit((res.data as { visit_id: string }).visit_id);
    expect(message.template_params).toMatchObject({ date_time: "15 Jan 2031, 10:30 am" });
    // 21:00 New York is past the evening shift (ends 21:00), whatever the UTC date is.
    const late = await callRegisterAndBook(tenantNy.client, registerAndBookArgs(tenantNy, new Date(Date.UTC(2031, 0, 16, 2, 0)).toISOString(), { p_patient_id: await seedPatient(tenantNy) }));
    expect(late.error).toMatchObject({ message: "SLOT_OFF_DUTY" });
  });

  it("a doctor without a stored schedule has no shift restriction", async () => {
    const free = await addMemberToTenant(tenantA.tenantId, "doctor");
    await setSchedule(tenantA.tenantId, free.userId, null);
    const res = await callRegisterAndBook(tenantA.client, registerAndBookArgs(tenantA, ist(3, 0, 3, 0), { p_patient_id: await seedPatient(tenantA), p_doctor_id: free.userId }));
    expect(res.error).toBeNull();
    // ...and a shift-less day is a day off.
    const off = await addMemberToTenant(tenantA.tenantId, "doctor");
    await setSchedule(tenantA.tenantId, off.userId, weekSchedule([]));
    const refused = await callRegisterAndBook(tenantA.client, registerAndBookArgs(tenantA, ist(3, 0, 11, 0), { p_patient_id: await seedPatient(tenantA), p_doctor_id: off.userId }));
    expect(refused.error).toMatchObject({ message: "SLOT_OFF_DUTY" });
  });
});

describe("register_and_book: each override clears only its own conflict (G-1)", () => {
  const week = 8;
  const offDuty = (dow: number) => ist(week, dow, 14, 0); // between the two shifts
  const inShift = (dow: number) => ist(week, dow, 11, 0);

  it("an off-duty override does not hide a block: SLOT_BLOCKED until the block is overridden too; then it books, flagged overbooked", async () => {
    await seedBlock(tenantA, offDuty(0), ist(week, 0, 15, 0), tenantA.userId);
    const m = marker();
    const res = await callRegisterAndBook(tenantA.client, registerAndBookArgs(tenantA, offDuty(0), { p_new_patient: newPatient(m), p_override_off_duty: true }));
    expect(res.error).toMatchObject({ code: "P0001", message: "SLOT_BLOCKED" });
    expect(await patientsMarked(tenantA.tenantId, m)).toEqual([]);

    const both = await callRegisterAndBook(tenantA.client, registerAndBookArgs(tenantA, offDuty(0), { p_patient_id: await seedPatient(tenantA), p_override_off_duty: true, p_override_block: true }));
    expect(both.error).toBeNull();
    expect((await visitsOfPatient((both.data as { patient_id: string }).patient_id))[0].is_overbooked).toBe(true);
  });

  it("an off-duty override does not hide a taken slot: SLOT_TAKEN, and nothing is registered", async () => {
    await seedBookedVisit(tenantA, await seedPatient(tenantA), tenantA.userId, offDuty(1));
    const m = marker();
    const res = await callRegisterAndBook(tenantA.client, registerAndBookArgs(tenantA, offDuty(1), { p_new_patient: newPatient(m), p_override_off_duty: true, p_override_block: true }));
    expect(res.error).toMatchObject({ code: "P0001", message: "SLOT_TAKEN" });
    expect(await patientsMarked(tenantA.tenantId, m)).toEqual([]);
  });

  it("a block override does not hide a taken slot: SLOT_TAKEN", async () => {
    await seedBlock(tenantA, inShift(2), ist(week, 2, 12, 0), tenantA.userId);
    await seedBookedVisit(tenantA, await seedPatient(tenantA), tenantA.userId, inShift(2));
    const res = await callRegisterAndBook(tenantA.client, registerAndBookArgs(tenantA, inShift(2), { p_patient_id: await seedPatient(tenantA), p_override_block: true }));
    expect(res.error).toMatchObject({ code: "P0001", message: "SLOT_TAKEN" });
  });

  it("an off-duty override on a free, in-shift slot books an ordinary booking (not overbooked) that holds the slot: a second booking is SLOT_TAKEN", async () => {
    const first = await callRegisterAndBook(tenantA.client, registerAndBookArgs(tenantA, inShift(3), { p_patient_id: await seedPatient(tenantA), p_override_off_duty: true }));
    expect(first.error).toBeNull();
    expect((await visitsOfPatient((first.data as { patient_id: string }).patient_id))[0].is_overbooked).toBe(false);
    const again = await callRegisterAndBook(tenantA.client, registerAndBookArgs(tenantA, inShift(3), { p_patient_id: await seedPatient(tenantA), p_override_off_duty: true }));
    expect(again.error).toMatchObject({ message: "SLOT_TAKEN" });
    const plain = await callRegisterAndBook(tenantA.client, registerAndBookArgs(tenantA, inShift(3), { p_patient_id: await seedPatient(tenantA) }));
    expect(plain.error).toMatchObject({ message: "SLOT_TAKEN" });
  });

  it("a block override on a free slot (no block there) is an ordinary booking that holds the slot", async () => {
    const first = await callRegisterAndBook(tenantA.client, registerAndBookArgs(tenantA, inShift(4), { p_patient_id: await seedPatient(tenantA), p_override_block: true }));
    expect(first.error).toBeNull();
    expect((await visitsOfPatient((first.data as { patient_id: string }).patient_id))[0].is_overbooked).toBe(false);
    const again = await callRegisterAndBook(tenantA.client, registerAndBookArgs(tenantA, inShift(4), { p_patient_id: await seedPatient(tenantA), p_override_block: true }));
    expect(again.error).toMatchObject({ message: "SLOT_TAKEN" });
  });

  it("an off-duty override on a slot that really is off duty books flagged overbooked, and that visit does not hold the slot", async () => {
    for (let i = 0; i < 2; i++) {
      const res = await callRegisterAndBook(tenantA.client, registerAndBookArgs(tenantA, offDuty(4), { p_patient_id: await seedPatient(tenantA), p_override_off_duty: true }));
      expect(res.error).toBeNull();
      expect((await visitsOfPatient((res.data as { patient_id: string }).patient_id))[0].is_overbooked).toBe(true);
    }
  });

  it("p_overbook still skips every check and flags the visit", async () => {
    await seedBlock(tenantA, offDuty(5), ist(week, 5, 15, 0), tenantA.userId);
    await seedBookedVisit(tenantA, await seedPatient(tenantA), tenantA.userId, offDuty(5));
    const res = await callRegisterAndBook(tenantA.client, registerAndBookArgs(tenantA, offDuty(5), { p_patient_id: await seedPatient(tenantA), p_overbook: true }));
    expect(res.error).toBeNull();
    expect((await visitsOfPatient((res.data as { patient_id: string }).patient_id))[0].is_overbooked).toBe(true);
  });
});

describe("register_and_book: the doctor is a clinician (G-9)", () => {
  it.each(["receptionist", "nurse", "admin"] as const)("a %s cannot be the doctor of a booking: DOCTOR_NOT_FOUND, nothing is registered", async (role) => {
    const m = marker();
    const args = registerAndBookArgs(tenantA, ist(9, 0, 11, 0), { p_new_patient: newPatient(m), p_doctor_id: members[role].userId });
    const res = await callRegisterAndBook(tenantA.client, args);
    expect(res.error).toMatchObject({ code: "P0002", message: "DOCTOR_NOT_FOUND" });
    expect(await patientsMarked(tenantA.tenantId, m)).toEqual([]);
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual([]);
  });

  it("an owner or a doctor can", async () => {
    for (const doctorId of [tenantA.userId, docB.userId]) {
      const res = await callRegisterAndBook(tenantA.client, registerAndBookArgs(tenantA, ist(9, 1, 11, 0), { p_patient_id: await seedPatient(tenantA), p_doctor_id: doctorId }));
      expect(res.error, doctorId).toBeNull();
    }
  });
});

describe("register_and_book: concurrency", () => {
  it("four desks book one slot with four new patients at once: one visit, three SLOT_TAKEN, one patient, one message", async () => {
    const desks = await Promise.all(Array.from({ length: 4 }, () => addMemberToTenant(tenantA.tenantId, "receptionist")));
    const barrier = createBarrier(4);
    const m = marker();
    const at = ist(4, 0, 11, 0);
    const results = await Promise.all(
      desks.map((desk, i) =>
        callRegisterAndBook(gateClient(desk.client, { rpc: { register_and_book: barrier } }), registerAndBookArgs(tenantA, at, { p_new_patient: newPatient(`${m}-${i}`) }))
      )
    );
    const wins = results.filter((r) => !r.error);
    const losses = results.filter((r) => r.error);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(3);
    for (const l of losses) expect(l.error).toMatchObject({ code: "P0001", message: "SLOT_TAKEN" });

    const patients = await patientsMarked(tenantA.tenantId, m);
    expect(patients).toHaveLength(1);
    const { count } = await getAdminClient()
      .from("visits")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantA.tenantId)
      .eq("doctor_id", tenantA.userId)
      .eq("scheduled_at", at);
    expect(count).toBe(1);
    expect(await messagesOfVisit((wins[0].data as { visit_id: string }).visit_id)).toHaveLength(1);
  });

  it("a visit another desk has written but not yet committed: the booking waits on the exclusion and ends as SLOT_TAKEN with no patient", async () => {
    const at = ist(4, 1, 11, 0);
    const holder = `HOLD-${randomUUID().slice(0, 8)}`;
    const holderPatient = await seedPatient(tenantA);
    // Session 1 inserts the visit and keeps its transaction open for 1.6 s (shorter than the command's 2 s lock_timeout).
    const held = psqlAsync(
      `/* ${holder} */ begin; insert into public.visits (tenant_id, patient_id, doctor_id, origin_type, status, scheduled_at, estimated_duration_minutes, created_by) ` +
        `values ('${tenantA.tenantId}', '${holderPatient}', '${tenantA.userId}', 'scheduled', 'booked', '${at}', 15, '${tenantA.userId}'); select pg_sleep(1.6); commit;`
    );
    // Wait until that transaction has written (it holds its transaction id), then book the same slot.
    const deadline = Date.now() + 8_000;
    for (;;) {
      const rows = psql(
        `select count(*) from pg_stat_activity a join pg_locks l on l.pid = a.pid ` +
          `where a.query like '%${holder}%' and a.pid <> pg_backend_pid() and l.locktype = 'transactionid' and l.granted`
      );
      if (rows[0] !== "0") break;
      if (Date.now() > deadline) throw new Error("the holding session never wrote");
      await new Promise((r) => setTimeout(r, 40));
    }
    const m = marker();
    const [res] = await Promise.all([callRegisterAndBook(tenantA.client, registerAndBookArgs(tenantA, at, { p_new_patient: newPatient(m) })), held]);
    expect(res.error).toMatchObject({ code: "P0001", message: "SLOT_TAKEN" });
    expect(await patientsMarked(tenantA.tenantId, m)).toEqual([]);
    expect(await visitsOfPatient(holderPatient)).toHaveLength(1);
  });
});

describe("register_and_book: idempotency", () => {
  it("the same id twice: one patient, one visit, one message, the first result with replayed: true", async () => {
    const m = marker();
    const args = registerAndBookArgs(tenantA, ist(5, 0, 11, 0), { p_new_patient: newPatient(m) });
    const first = await callRegisterAndBook(tenantA.client, args);
    const second = await callRegisterAndBook(tenantA.client, args);
    expect(second.error).toBeNull();
    expect(second.data).toEqual({ ...(first.data as object), replayed: true });
    const [patient] = await patientsMarked(tenantA.tenantId, m);
    const visits = await visitsOfPatient(patient.id);
    expect(visits).toHaveLength(1);
    expect(await messagesOfVisit(visits[0].id)).toHaveLength(1);
  });

  it("the same id for another slot, doctor or flag is IDEMPOTENCY_MISMATCH and writes nothing", async () => {
    const patientId = await seedPatient(tenantA);
    const args = registerAndBookArgs(tenantA, ist(5, 1, 11, 0), { p_patient_id: patientId });
    expect((await callRegisterAndBook(tenantA.client, args)).error).toBeNull();
    // Every input that the command acts on is part of the request hash (G-7): a retry may repeat a request, never change it.
    for (const over of [
      { p_scheduled_at: ist(5, 1, 12, 0) },
      { p_doctor_id: docB.userId },
      { p_overbook: true },
      { p_override_block: true },
      { p_override_off_duty: true },
      { p_reason: "A different reason" },
      { p_duration_minutes: 30 },
    ]) {
      const res = await callRegisterAndBook(tenantA.client, { ...args, ...over });
      expect(mapDbError(res.error), JSON.stringify(over)).toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    }
    expect(await visitsOfPatient(patientId)).toHaveLength(1);
  });

  it("a refused slot leaves the id free: the overbook confirmation can re-send it", async () => {
    const week = 5;
    const at = ist(week, 2, 11, 0);
    expect((await callRegisterAndBook(tenantA.client, registerAndBookArgs(tenantA, at, { p_patient_id: await seedPatient(tenantA) }))).error).toBeNull();
    const m = marker();
    const args = registerAndBookArgs(tenantA, at, { p_new_patient: newPatient(m) });
    expect((await callRegisterAndBook(tenantA.client, args)).error).toMatchObject({ message: "SLOT_TAKEN" });
    const confirmed = await callRegisterAndBook(tenantA.client, { ...args, p_overbook: true });
    expect(confirmed.error).toBeNull();
    // One patient, however many attempts it took.
    expect(await patientsMarked(tenantA.tenantId, m)).toHaveLength(1);
  });
});

describe("register_and_book: input", () => {
  it.each([
    ["both a patient and a new patient", async () => ({ p_patient_id: await seedPatient(tenantA), p_new_patient: newPatient(marker()) })],
    ["neither", async () => ({})],
    ["a missing time", async () => ({ p_new_patient: newPatient(marker()), p_scheduled_at: null })],
    ["a duration of 4 minutes", async () => ({ p_new_patient: newPatient(marker()), p_duration_minutes: 4 })],
    ["a duration of 481 minutes", async () => ({ p_new_patient: newPatient(marker()), p_duration_minutes: 481 })],
    ["a missing doctor", async () => ({ p_new_patient: newPatient(marker()), p_doctor_id: null })],
    ["a new patient with a bad phone", async () => ({ p_new_patient: newPatient(marker(), { phone: "123" }) })],
  ])("%s: INPUT_INVALID, nothing is written", async (_name, build) => {
    const over = await build();
    const args = registerAndBookArgs(tenantA, ist(5, 3, 11, 0), over as never);
    const res = await callRegisterAndBook(tenantA.client, args);
    expect(res.error).toMatchObject({ code: "P0001", message: "INPUT_INVALID" });
    expect(commandResultRows(tenantA.tenantId, args.p_client_request_id)).toEqual([]);
    const name = (over as { p_new_patient?: { full_name?: string } }).p_new_patient?.full_name;
    if (name) expect(await patientsMarked(tenantA.tenantId, name)).toEqual([]);
  });

  it("a missing request id is CLIENT_REQUEST_ID_REQUIRED", async () => {
    const m = marker();
    const res = await callRegisterAndBook(tenantA.client, registerAndBookArgs(tenantA, ist(5, 3, 11, 0), { p_new_patient: newPatient(m), p_client_request_id: null as unknown as string }));
    expect(res.error).toMatchObject({ code: "P0001", message: "CLIENT_REQUEST_ID_REQUIRED" });
    expect(await patientsMarked(tenantA.tenantId, m)).toEqual([]);
  });
});

describe("register_and_book: who may call it", () => {
  it.each(ROLES)("%s: allowed exactly when the matrix grants appointments:edit (and patients:edit for a new patient)", async (role) => {
    const idx = ROLES.indexOf(role);
    const existing = await callRegisterAndBook(members[role].client, registerAndBookArgs(tenantA, ist(6, idx, 11, 0), { p_patient_id: await seedPatient(tenantA) }));
    if (hasPerm(role, "appointments:edit")) expect(existing.error).toBeNull();
    else expect(existing.error?.code).toBe("42501");

    const m = marker();
    const fresh = await callRegisterAndBook(members[role].client, registerAndBookArgs(tenantA, ist(6, idx, 12, 0), { p_new_patient: newPatient(m) }));
    if (hasPerm(role, "appointments:edit") && hasPerm(role, "patients:edit")) {
      expect(fresh.error).toBeNull();
      expect(await patientsMarked(tenantA.tenantId, m)).toHaveLength(1);
    } else {
      expect(fresh.error?.code).toBe("42501");
      expect(await patientsMarked(tenantA.tenantId, m)).toEqual([]);
    }
  });

  it("anon cannot execute it (42501)", async () => {
    const anon = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    }) as TestDb;
    const m = marker();
    const { data, error } = await callRegisterAndBook(anon, registerAndBookArgs(tenantA, ist(6, 5, 11, 0), { p_new_patient: newPatient(m) }));
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
    expect(await patientsMarked(tenantA.tenantId, m)).toEqual([]);
  });

  it("another clinic is NOT_FOUND whichever clinic is named, and nothing is written", async () => {
    const m = marker();
    const foreignPatient = await seedPatient(tenantB);
    for (const [named, over] of [
      [tenantB, { p_new_patient: newPatient(m) }],
      [tenantB, { p_patient_id: foreignPatient }],
      [tenantA, { p_patient_id: foreignPatient }],
    ] as const) {
      const res = await callRegisterAndBook(tenantA.client, registerAndBookArgs(named, ist(6, 5, 12, 0), over as never));
      expect(res.error).toMatchObject({ code: "P0002", message: "PATIENT_NOT_FOUND" });
      expect(mapDbError(res.error).code).toBe("NOT_FOUND");
    }
    expect(await patientsMarked(tenantB.tenantId, m)).toEqual([]);
    expect(await visitsOfPatient(foreignPatient)).toEqual([]);
  });

  it("a member of A and B acting in A cannot book in B, naming B or A, but can in B", async () => {
    const dual = await createDualMembershipUser(tenantA.tenantId, "receptionist", tenantB.tenantId, "receptionist");
    const actingInA = await signInActingIn(dual.userEmail, tenantA.tenantId);
    const m = marker();
    for (const named of [tenantB, tenantA]) {
      const res = await callRegisterAndBook(actingInA, registerAndBookArgs(named, ist(6, 4, 11, 0), { p_new_patient: newPatient(m), p_doctor_id: tenantB.userId }));
      // Naming B is not the active clinic; naming A passes that guard and then finds no such doctor in A.
      expect(res.error, `named ${named.tenantName}`).toMatchObject({
        code: "P0002",
        message: named === tenantB ? "PATIENT_NOT_FOUND" : "DOCTOR_NOT_FOUND",
      });
    }
    expect(await patientsMarked(tenantB.tenantId, m)).toEqual([]);

    const actingInB = await signInActingIn(dual.userEmail, tenantB.tenantId);
    const ok = await callRegisterAndBook(actingInB, registerAndBookArgs(tenantB, ist(6, 4, 11, 0), { p_new_patient: newPatient(m) }));
    expect(ok.error).toBeNull();
    const [patient] = await patientsMarked(tenantB.tenantId, m);
    expect(await auditRows(tenantB.tenantId, "patient.create", patient.id)).toEqual([
      expect.objectContaining({ actor_id: dual.userId, actor_role: "receptionist", actor_type: "user" }),
    ]);
  });
});

describe("registerAndBook (service)", () => {
  it("books, replays on the same id, and reports the slot refusals as CONFLICT with their reason and a fixed text", async () => {
    const m = marker();
    const id = randomUUID();
    const input = { new_patient: newPatient(m), doctor_id: tenantA.userId, scheduled_at: ist(7, 0, 11, 0), estimated_duration_minutes: 15 };
    const first = await registerAndBook(ctxFor(members.receptionist), input, id);
    expect(first).toMatchObject({ ok: true, value: { patientCreated: true, messageEnqueued: true, replayed: false } });
    expect(await registerAndBook(ctxFor(members.receptionist), input, id)).toMatchObject({ ok: true, value: { replayed: true } });
    expect(await patientsMarked(tenantA.tenantId, m)).toHaveLength(1);

    const taken = await registerAndBook(ctxFor(tenantA), { ...input, new_patient: newPatient(marker()) }, randomUUID());
    expect(taken).toMatchObject({ ok: false, error: { code: "CONFLICT", reason: "SLOT_TAKEN", message: BOOKING_COMMAND_MESSAGES.SLOT_TAKEN } });
    const off = await registerAndBook(ctxFor(tenantA), { ...input, new_patient: newPatient(marker()), scheduled_at: ist(7, 0, 14, 0) }, randomUUID());
    expect(off).toMatchObject({ ok: false, error: { code: "CONFLICT", reason: "SLOT_OFF_DUTY", message: BOOKING_COMMAND_MESSAGES.SLOT_OFF_DUTY } });
    const confirmed = await registerAndBook(ctxFor(tenantA), { ...input, new_patient: newPatient(marker()), scheduled_at: ist(7, 0, 14, 0), override_off_duty: true }, randomUUID());
    expect(confirmed.ok).toBe(true);
  });

  it("refuses malformed input and a missing patient with fixed texts before any call", async () => {
    const base = { doctor_id: tenantA.userId, scheduled_at: ist(7, 1, 11, 0) };
    expect(await registerAndBook(ctxFor(tenantA), { ...base }, randomUUID())).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(await registerAndBook(ctxFor(tenantA), { ...base, patient_id: randomUUID() }, "not-a-uuid")).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(await registerAndBook(ctxFor(tenantA), { ...base, scheduled_at: "tomorrow", patient_id: randomUUID() }, randomUUID())).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    const m = marker();
    const bad = await registerAndBook(ctxFor(tenantA), { ...base, new_patient: { full_name: m, phone: "12" } }, randomUUID());
    expect(bad).toMatchObject({ ok: false, error: { code: "VALIDATION_FAILED" } });
    expect(await patientsMarked(tenantA.tenantId, m)).toEqual([]);
  });

  it("another clinic's patient reads as not found", async () => {
    const foreign = await seedPatient(tenantB);
    expect(
      await registerAndBook(ctxFor(tenantA), { patient_id: foreign, doctor_id: tenantA.userId, scheduled_at: ist(7, 2, 11, 0) }, randomUUID())
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND", message: BOOKING_COMMAND_MESSAGES.NOT_FOUND } });
  });
});
