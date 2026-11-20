/**
 * Seeds for the Today specs (V2-08 08-03a): visits of the run's clinic A for the clinic's own day, synthetic data only.
 * A booked visit is overbooked on purpose, so seeding never collides with another spec's slot (the exclusion constraint
 * only covers visits that are not overbooked). Everything is inserted in its final state (the visit state machine refuses
 * most status updates), through the service role.
 */
import { getAdminClient } from "../../helpers/supabase-admin";
import { appToday, istInstant, run, seedPatient, testTag } from "./m0-data";

export interface TodayVisit {
  visitId: string;
  patientId: string;
  name: string;
}

export function todayName(label: string): string {
  return `E2E Synthetic Today ${label} ${testTag()}`;
}

/** A booked visit for today (clinic time `time`, default 10:00) with the run's doctor. */
export async function seedBookedToday(name = todayName("Booked"), time = "10:00"): Promise<TodayVisit> {
  const { tenantA } = run();
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, name);
  const { data, error } = await getAdminClient()
    .from("visits")
    .insert({
      tenant_id: tenantA.id,
      patient_id: patient.id,
      doctor_id: tenantA.users.doctor.id,
      origin_type: "scheduled",
      status: "booked",
      scheduled_at: istInstant(appToday(), time),
      is_overbooked: true,
      estimated_duration_minutes: 15,
      created_by: tenantA.users.receptionist.id,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`today seed: booked visit failed: ${error?.message}`);
  return { visitId: data.id, patientId: patient.id, name };
}

/** A walk-in already in the queue (status `waiting`) with the next free token of the day. */
export async function seedWaitingToday(name = todayName("Waiting"), vitals?: Record<string, number>): Promise<TodayVisit & { token: number }> {
  const { tenantA } = run();
  const admin = getAdminClient();
  const patient = await seedPatient(tenantA.id, tenantA.users.owner.id, name);
  const { data, error } = await admin
    .from("visits")
    .insert({
      tenant_id: tenantA.id,
      patient_id: patient.id,
      doctor_id: tenantA.users.doctor.id,
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
