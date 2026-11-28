/**
 * Seeds for the Today specs (V2-08 08-03a): visits of the run's clinic A for the clinic's own day, synthetic data only.
 * A booked visit is overbooked on purpose, so seeding never collides with another spec's slot (the exclusion constraint
 * only covers visits that are not overbooked). Everything is inserted in its final state (the visit state machine refuses
 * most status updates), through the service role.
 */
import { getAdminClient } from "../../helpers/supabase-admin";
import { addMemberToTenant, seedTenantWithOwner } from "../../helpers/tenants";
import { appToday, istInstant, run, seedPatient, testTag } from "./m0-data";

export interface TodayVisit {
  visitId: string;
  patientId: string;
  name: string;
}

export function todayName(label: string): string {
  return `E2E Synthetic Today ${label} ${testTag()}`;
}

/** Where a seeded visit lives: by default the run's clinic A, its doctor and its receptionist. */
export interface TodayClinic {
  tenantId: string;
  /** Registers the patient. */
  ownerId: string;
  doctorId: string;
  /** Creates the visit. */
  createdBy: string;
}

function clinicA(): TodayClinic {
  const { tenantA } = run();
  return { tenantId: tenantA.id, ownerId: tenantA.users.owner.id, doctorId: tenantA.users.doctor.id, createdBy: tenantA.users.receptionist.id };
}

/** A booked visit for today (clinic time `time`, default 10:00) with the run's doctor, or in `clinic`. */
export async function seedBookedToday(name = todayName("Booked"), time = "10:00", clinic: TodayClinic = clinicA()): Promise<TodayVisit> {
  const patient = await seedPatient(clinic.tenantId, clinic.ownerId, name);
  const { data, error } = await getAdminClient()
    .from("visits")
    .insert({
      tenant_id: clinic.tenantId,
      patient_id: patient.id,
      doctor_id: clinic.doctorId,
      origin_type: "scheduled",
      status: "booked",
      scheduled_at: istInstant(appToday(), time),
      is_overbooked: true,
      estimated_duration_minutes: 15,
      created_by: clinic.createdBy,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`today seed: booked visit failed: ${error?.message}`);
  return { visitId: data.id, patientId: patient.id, name };
}

/** A walk-in already in the queue (status `waiting`) with the next free token of the day. */
export async function seedWaitingToday(
  name = todayName("Waiting"),
  vitals?: Record<string, number>,
  doctorId?: string,
): Promise<TodayVisit & { token: number }> {
  const { tenantA } = run();
  const admin = getAdminClient();
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, name);
  const { data, error } = await admin
    .from("visits")
    .insert({
      tenant_id: tenantA.id,
      patient_id: patient.id,
      doctor_id: doctorId ?? tenantA.users.doctor.id,
      origin_type: "walk_in",
      status: "waiting",
      estimated_duration_minutes: 15,
      created_by: tenantA.users.receptionist.id,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`today seed: waiting visit failed: ${error?.message}`);
  const { data: top } = await admin
    .from("queue_tokens")
    .select("token_number")
    .eq("tenant_id", tenantA.id)
    .eq("date", appToday())
    .order("token_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const token = (top?.token_number ?? 0) + 1;
  const inserted = await admin
    .from("queue_tokens")
    .insert({ tenant_id: tenantA.id, visit_id: data.id, token_number: token, date: appToday(), priority: "normal" });
  if (inserted.error) throw new Error(`today seed: token failed: ${inserted.error.message}`);
  if (vitals) {
    const noted = await admin.from("clinical_notes").update({ vitals }).eq("visit_id", data.id);
    if (noted.error) throw new Error(`today seed: vitals failed: ${noted.error.message}`);
  }
  return { visitId: data.id, patientId: patient.id, name, token };
}

/** The vitals JSON stored on the visit's clinical note (null when none). */
export async function vitalsOfVisit(visitId: string): Promise<Record<string, unknown> | null> {
  const { data } = await getAdminClient().from("clinical_notes").select("vitals").eq("visit_id", visitId).maybeSingle();
  return (data?.vitals as Record<string, unknown> | null) ?? null;
}

export async function visitStatusOf(visitId: string): Promise<string | null> {
  const { data } = await getAdminClient().from("visits").select("status").eq("id", visitId).maybeSingle();
  return data?.status ?? null;
}

export async function tokensOfVisit(visitId: string): Promise<number[]> {
  const { data } = await getAdminClient().from("queue_tokens").select("token_number").eq("visit_id", visitId);
  return (data ?? []).map((t) => t.token_number);
}

/** A clinic day with every lane filled: booked, waiting (with vitals), with the doctor, to bill (500 due) and done. */
export async function seedFullDay(): Promise<{ booked: string; waiting: string; withDoctor: string; toBill: string; done: string }> {
  const { tenantA } = run();
  const admin = getAdminClient();
  const names = {
    booked: todayName("Booked"),
    waiting: todayName("Waiting"),
    withDoctor: todayName("WithDoctor"),
    toBill: todayName("ToBill"),
    done: todayName("Done"),
  };
  await seedBookedToday(names.booked, "17:30");
  await seedWaitingToday(names.waiting, { systolic: 150, diastolic: 95, pulse: 88 });
  const base = {
    tenant_id: tenantA.id,
    doctor_id: tenantA.users.doctor.id,
    origin_type: "walk_in",
    created_by: tenantA.users.receptionist.id,
    estimated_duration_minutes: 15,
  };
  for (const [name, status, fee, paid] of [
    [names.withDoctor, "in_consultation", 0, 0],
    [names.toBill, "completed", 700, 200],
    [names.done, "completed", 500, 500],
  ] as const) {
    const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, name);
    const { data: visit } = await admin.from("visits").insert({ ...base, patient_id: patient.id, status }).select("id").single();
    const { data: top } = await admin
      .from("queue_tokens")
      .select("token_number")
      .eq("tenant_id", tenantA.id)
      .eq("date", appToday())
      .order("token_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    await admin
      .from("queue_tokens")
      .insert({ tenant_id: tenantA.id, visit_id: visit!.id, token_number: (top?.token_number ?? 0) + 1, date: appToday(), priority: "normal" });
    if (fee > 0) {
      const { data: invoice } = await admin
        .from("invoices")
        .insert({
          tenant_id: tenantA.id,
          visit_id: visit!.id,
          patient_id: patient.id,
          invoice_number: `E2E-${Math.random().toString(36).slice(2, 9)}`,
          subtotal: fee,
          total_amount: fee,
        })
        .select("id")
        .single();
      await admin
        .from("payments")
        .insert({ tenant_id: tenantA.id, invoice_id: invoice!.id, amount: paid, payment_method: "cash", recorded_by: tenantA.users.receptionist.id });
    }
  }
  return names;
}

/**
 * A clinic of the test's own: an owner (the observer, a practicing doctor) and a receptionist (the screen that checks in), both signed in through the login
 * UI by the spec. A signal makes a screen re-read and re-render the whole clinic day, and clinic A's day grows with every spec of every project. CI
 * 44942218223: iphone-15 runs last (about an hour in); the day held 397 visits, and the 1280 px observer received the signal and the refreshed day in time
 * but had not drawn it within 2 s on the runner's WebKit. The 2 s is measured on a clinic day the test controls, not on what the run has left in clinic A.
 */
export async function ownClinic(): Promise<{ owner: { email: string }; receptionist: { email: string }; seed: () => ReturnType<typeof seedBookedToday> }> {
  const owner = await seedTenantWithOwner(`E2E Synthetic Clinic Live ${testTag()}`);
  const receptionist = await addMemberToTenant(owner.tenantId, "receptionist");
  const clinic = { tenantId: owner.tenantId, ownerId: owner.userId, doctorId: owner.userId, createdBy: receptionist.userId };
  return {
    owner: { email: owner.userEmail },
    receptionist: { email: receptionist.userEmail },
    seed: () => seedBookedToday(todayName("Booked"), "10:00", clinic),
  };
}
