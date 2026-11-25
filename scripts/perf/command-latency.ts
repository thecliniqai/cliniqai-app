/**
 * Command latency record (V2-08 08-05, R-4): the p95 latency of every V2-07 and V2-08 definer command on the LOCAL Supabase stack,
 * next to the latency of plain INVOKER reads on the same stack, so "definer commands must not slow the app" is a number.
 *
 *   npx tsx scripts/perf/command-latency.ts --out .planning/phases/08-front-desk/evidence/command-latency.json
 *   npx tsx scripts/perf/command-latency.ts --calls 5        a short smoke run (prints, writes nothing without --out)
 *
 * What is timed: one `supabase-js` RPC (or select) from this process, as a signed-in clinic user, through the local PostgREST: the
 * whole round trip a server action makes to the database (HTTP, JWT check, the function, the response). Every command is called
 * `--calls` times (default 100) with a fresh `p_client_request_id` and a fresh, prepared target row each time (a visit in the
 * right state, a free slot, a new patient); the rows are seeded with the service-role client OUTSIDE the timed region, and a few
 * warm-up calls (not counted) come first. Calls run one after another. Percentiles are nearest-rank over the timed calls.
 *
 * Target (R-4): p95 under 150 ms for every command on the local stack. Exit 1 when any command's p95 is 150 ms or more, or any
 * call failed (a failing call would time the error path): a miss is a finding to fix (an index, a lock), not a reason to move
 * the target. V2-09e R-16, H-1: the medicine catalogue's first and last brand shards on the full-size synthetic catalogue (93,911 brands, the lane's
 * perf-* rows, upserted and deleted by this run) have their own target, p95 under 200 ms. Output: p50, p95, p99 per call, the ratio of the command's p95 to the baseline's, the node version and the CPU
 * count. No names, no ids, no data.
 *
 * Safety: follows scripts/seed-local-dev.ts. Reads `.env.test` and `npx supabase status` only (never `.env`), then refuses to run
 * unless every URL is loopback and every key is a local-stack key (`assertLocalTestEnv`). Synthetic data only: it creates one
 * "Synthetic Latency Clinic" with an owner and a receptionist, and removes the clinic and both users when it ends (or fails).
 * Run it while nothing else uses the local stack. No new dependency.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { assertLocalTestEnv, loadLocalStackKeys, loadTestEnv } from "../../tests/setup/test-env";

const ROOT = path.resolve(__dirname, "../..");
const TARGET_MS = 150;
/** V2-09b R-18: the INVOKER Smart Assist reads (consult_assist_context, search_diagnoses, patient_snapshot) on the synthetic seed: p95 under 50 ms. */
const READ_TARGET_MS = 50;
/** V2-09e R-16, H-1: one brand shard of the medicine catalogue the device downloads (12,000 brands of the full-size 93,911): p95 under 200 ms. */
const REFERENCE_TARGET_MS = 200;
const WARMUP = 5;

/** A pseudo-word of `length` letters from an MD5 digest (`translate(md5(n), '0123456789abcdef', 'ghijklmnopqrstuv')`), capitalised: a stand-in brand or generic name. */
export function latencyWord(n: number, length: number): string {
  const letters = createHash("md5").update(String(n)).digest("hex").replace(/[0-9a-f]/g, (c) => "ghijklmnopqrstuv"[parseInt(c, 16)]).slice(0, length);
  return letters.charAt(0).toUpperCase() + letters.slice(1);
}

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

export interface LatencyRow {
  name: string;
  kind: "command" | "baseline" | "read" | "reference";
  calls: number;
  errors: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  /** p95 of this command over the p95 of the plain `visits` select (the INVOKER baseline). */
  p95_over_baseline: number | null;
}

/** Nearest-rank percentile of an ascending list. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1]!;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

type Call = () => PromiseLike<{ error: { message: string } | null }>;

async function timeCalls(calls: Call[], warmup: number): Promise<{ ms: number[]; errors: number; firstError: string | null }> {
  const ms: number[] = [];
  let errors = 0;
  let firstError: string | null = null;
  for (let i = 0; i < calls.length; i++) {
    const started = performance.now();
    const { error } = await calls[i]!();
    const took = performance.now() - started;
    if (error) {
      errors += 1;
      firstError ??= error.message;
    }
    if (i >= warmup) ms.push(took);
  }
  return { ms, errors, firstError };
}

async function main(): Promise<void> {
  loadTestEnv(ROOT);
  loadLocalStackKeys(ROOT);
  assertLocalTestEnv();
  const callsPerCommand = Number(argValue("--calls") ?? 100);
  if (!Number.isInteger(callsPerCommand) || callsPerCommand < 1) throw new Error("--calls must be a positive integer");
  const out = argValue("--out");

  // The helpers read the environment when they are imported, so they load after the guard above.
  const { seedTenantWithOwner, addMemberToTenant } = await import("../../tests/helpers/tenants");
  const { getAdminClient } = await import("../../tests/helpers/supabase-admin");
  const { seedVisit, createInvoiceArgs, collectPaymentArgs } = await import("../../tests/helpers/billing-commands");
  const clinical = await import("../../tests/helpers/clinical-commands");
  const desk = await import("../../tests/helpers/front-desk-commands");
  const sched = await import("../../tests/helpers/scheduling-commands");
  const { seedSlotIso } = await import("../../tests/helpers/seed-slots");

  const admin = getAdminClient();
  const owner = await seedTenantWithOwner(`Synthetic Latency Clinic ${Date.now()}`);
  const receptionist = await addMemberToTenant(owner.tenantId, "receptionist");
  const t = { tenantId: owner.tenantId, userId: owner.userId };
  const N = callsPerCommand + WARMUP;
  const rows: Array<Omit<LatencyRow, "p95_over_baseline">> = [];
  const catalogueIds: string[] = [];
  let failed = false;
  let perfCatalogueLoaded = false;

  /** Prepares N calls (seeding outside the timed region), times them, and records one row. */
  async function measure(name: string, kind: LatencyRow["kind"], prepare: (i: number) => Promise<Call>): Promise<void> {
    const calls: Call[] = [];
    for (let i = 0; i < N; i++) calls.push(await prepare(i));
    const { ms, errors, firstError } = await timeCalls(calls, WARMUP);
    const sorted = [...ms].sort((a, b) => a - b);
    rows.push({
      name,
      kind,
      calls: sorted.length,
      errors,
      p50_ms: round1(percentile(sorted, 50)),
      p95_ms: round1(percentile(sorted, 95)),
      p99_ms: round1(percentile(sorted, 99)),
    });
    if (errors > 0) {
      failed = true;
      console.error(`[latency] ${name}: ${errors} of ${N} calls failed (first: ${firstError})`);
    }
    console.log(`[latency] ${name.padEnd(28)} p50 ${round1(percentile(sorted, 50))} ms  p95 ${round1(percentile(sorted, 95))} ms  p99 ${round1(percentile(sorted, 99))} ms`);
  }

  // Distinct instants for seeded and booked times: 15-minute grid inside the default hours (Mon-Sat 10:00-13:00), 2031.
  let slotCounter = 0;
  const nextFreeSlot = (): string => {
    const n = slotCounter++;
    const perDay = 12;
    const day = Math.floor(n / perDay);
    const week = Math.floor(day / 6);
    return sched.ist(week + 1, day % 6, 10 + Math.floor((n % perDay) / 4), (n % 4) * 15);
  };
  const today = () => new Date().toISOString();
  const ymd = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

  try {
    // ---- V2-07 commands ---------------------------------------------------------------------------------------------------------
    await measure("create_invoice", "command", async () => {
      const { visitId } = await seedVisit(t);
      const args = createInvoiceArgs(t, visitId);
      return () => owner.client.rpc("create_invoice", args);
    });
    await measure("collect_payment", "command", async () => {
      const { visitId } = await seedVisit(t);
      const args = collectPaymentArgs(t, visitId);
      return () => owner.client.rpc("collect_payment", args);
    });
    await measure("sign_consultation", "command", async () => {
      const { visitId } = await clinical.seedClinicalVisit(t);
      const args = clinical.signArgs(t, visitId);
      return () => owner.client.rpc("sign_consultation", args);
    });
    await measure("reopen_visit_for_amendment", "command", async () => {
      const { visitId } = await clinical.seedClinicalVisit(t);
      const signed = await owner.client.rpc("sign_consultation", clinical.signArgs(t, visitId));
      if (signed.error) throw new Error(`prepare reopen: sign failed: ${signed.error.message}`);
      // 09A-06a (A-3): the reopen waits until the signed version's Rx PDF is archived, by its signer (here the owner who signed).
      await clinical.archiveRxAs(owner, visitId);
      const args = clinical.reopenArgs(t, visitId);
      return () => owner.client.rpc("reopen_visit_for_amendment", args);
    });
    await measure("finalize_visit_amendment", "command", async () => {
      const { visitId } = await clinical.seedClinicalVisit(t);
      const signed = await owner.client.rpc("sign_consultation", clinical.signArgs(t, visitId));
      if (signed.error) throw new Error(`prepare finalize: sign failed: ${signed.error.message}`);
      await clinical.archiveRxAs(owner, visitId);
      const reopened = await owner.client.rpc("reopen_visit_for_amendment", clinical.reopenArgs(t, visitId));
      if (reopened.error) throw new Error(`prepare finalize: reopen failed: ${reopened.error.message}`);
      const args = clinical.finalizeArgs(t, visitId);
      return () => owner.client.rpc("finalize_visit_amendment", args);
    });
    await measure("check_in_visit", "command", async () => {
      const { visitId } = await seedVisit(t, undefined, { status: "booked", scheduledAt: today(), overbooked: true });
      const args = clinical.checkInArgs(t, visitId);
      return () => receptionist.client.rpc("check_in_visit", args);
    });
    await measure("enqueue_walk_in", "command", async () => {
      const patientId = await desk.seedPatient(t);
      const args = desk.walkInArgs(t, { p_patient_id: patientId });
      return () => receptionist.client.rpc("enqueue_walk_in", args);
    });
    await measure("register_and_book", "command", async (i) => {
      const args = desk.registerAndBookArgs(t, nextFreeSlot(), { p_new_patient: desk.newPatient(`latency ${i}`) });
      return () => receptionist.client.rpc("register_and_book", args);
    });
    await measure("complete_and_bill", "command", async () => {
      const { visitId } = await clinical.seedClinicalVisit(t);
      const args = desk.completeAndBillArgs(t, visitId);
      return () => owner.client.rpc("complete_and_bill", args);
    });

    // ---- V2-08 commands ---------------------------------------------------------------------------------------------------------
    await measure("start_consultation", "command", async () => {
      const { visitId } = await seedVisit(t, undefined, { status: "booked", scheduledAt: today(), overbooked: true });
      const args = clinical.startConsultationArgs(t, visitId);
      return () => owner.client.rpc("start_consultation", args);
    });
    // 08-06a S-4: the desk completes a waiting visit only (an in_consultation one is VISIT_NOT_COMPLETABLE), so the timed call needs a waiting one.
    await measure("complete_visit", "command", async () => {
      const { visitId } = await seedVisit(t, undefined, { status: "waiting" });
      const args = clinical.completeVisitArgs(t, visitId);
      return () => receptionist.client.rpc("complete_visit", args);
    });
    // V2-09b 09B-01 (R-18): the consult's draft save, one call per fresh in-consultation visit at version 0, a patch of the note, the advice and a follow-up
    // (the heaviest the saver sends at once). The V2-08 condition: p95 under 150 ms.
    await measure("save_consultation_draft", "command", async (i) => {
      const { visitId } = await seedVisit(t, undefined, { status: "in_consultation" });
      const args = {
        p_tenant_id: t.tenantId,
        p_visit_id: visitId,
        p_expected_version: 0,
        p_patch: {
          clinical_notes: `Synthetic latency note ${i}`,
          advice: ["Synthetic advice"],
          follow_up: { follow_up_date: ymd(7), notes: null },
        },
        p_client_request_id: randomUUID(),
      };
      return () => owner.client.rpc("save_consultation_draft", args);
    });
    // V2-09c 09C-01 (R-17): one Rx change on a fresh in-consultation visit: a header created, a catalogue line and two custom lines added (the heaviest a
    // template apply sends at once, with the custom medicine upserts). The V2-08 condition: p95 under 150 ms.
    const cdciOne = await admin
      .from("cdci_medicines_search")
      .upsert({ id: "test-cdci-09c-lat-000001", brand_name: "Latency Catalogue Tab", generic_name: "Latencyol 1", dose_form: "Tablet", product_name: "Latency product 1", supplier_name: "Synthetic Labs" }, { onConflict: "id" });
    if (cdciOne.error) throw new Error(`CDCI seed failed: ${cdciOne.error.message}`);
    // V2-09c 09C-02 (R-7): the patients carry three recorded allergies, so every add runs the allergy check (none of the lines matches).
    await measure("change_prescription", "command", async (i) => {
      const { visitId, patientId } = await seedVisit(t, undefined, { status: "in_consultation" });
      const withAllergies = await admin.from("patients").update({ allergies: ["Latency allergen", "Latency substance 7", "Penicillin"] }).eq("id", patientId);
      if (withAllergies.error) throw new Error(`allergy seed failed: ${withAllergies.error.message}`);
      const args = {
        p_tenant_id: t.tenantId,
        p_visit_id: visitId,
        p_changes: {
          add: [
            { medicine_name: "Latency Catalogue Tab", dosage: "1-0-1", duration: "5 days", cdci_brand_id: "test-cdci-09c-lat-000001" },
            { medicine_name: `Latency Custom A ${i}`, dosage: "1-0-0", timing: "After food", duration: "3 days" },
            { medicine_name: `Latency Custom B ${i}`, dosage: "0-0-1", duration: "7 days", special_instructions: "Synthetic instruction" },
          ],
        },
        p_client_request_id: randomUUID(),
      };
      return () => owner.client.rpc("change_prescription", args);
    });
    // V2-09c 09C-02 (R-8): the allergy record, one call per fresh patient (three strings, one of them a substance name).
    await measure("record_patient_allergies", "command", async () => {
      const { patientId } = await seedVisit(t, undefined, { status: "waiting" });
      const args = { p_tenant_id: t.tenantId, p_patient_id: patientId, p_allergies: ["Latency substance 7", "Latency allergen", "Penicillin"], p_expected: null, p_client_request_id: randomUUID() };
      return () => owner.client.rpc("record_patient_allergies", args);
    });
    await measure("register_patient", "command", async (i) => {
      const args = {
        p_tenant_id: t.tenantId,
        p_patient: desk.newPatient(`latency register ${i}`) as unknown as never,
        p_client_request_id: randomUUID(),
      };
      return () => receptionist.client.rpc("register_patient", args);
    });
    await measure("reschedule_visit", "command", async () => {
      const { visitId } = await seedVisit(t, undefined, { status: "booked", scheduledAt: seedSlotIso(), overbooked: true });
      const args = sched.rescheduleArgs(t, visitId, nextFreeSlot());
      return () => receptionist.client.rpc("reschedule_visit", args);
    });
    await measure("cancel_visit", "command", async () => {
      const { visitId } = await seedVisit(t, undefined, { status: "booked", scheduledAt: seedSlotIso(), overbooked: true });
      const args = sched.cancelArgs(t, visitId);
      return () => receptionist.client.rpc("cancel_visit", args);
    });
    await measure("mark_no_show", "command", async () => {
      const { visitId } = await seedVisit(t, undefined, {
        status: "booked",
        scheduledAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
        overbooked: true,
      });
      const args = sched.markNoShowArgs(t, visitId);
      return () => receptionist.client.rpc("mark_no_show", args);
    });
    await measure("confirm_appointment", "command", async () => {
      const { visitId } = await seedVisit(t, undefined, { status: "booked", scheduledAt: seedSlotIso(), overbooked: true });
      const args = sched.confirmArgs(t, visitId);
      return () => receptionist.client.rpc("confirm_appointment", args);
    });
    await measure("add_to_waitlist", "command", async () => {
      const patientId = await desk.seedPatient(t);
      const args = sched.addToWaitlistArgs(t, patientId, ymd(3));
      return () => receptionist.client.rpc("add_to_waitlist", args);
    });
    await measure("promote_waitlist_entry", "command", async () => {
      const patientId = await desk.seedPatient(t);
      const entryId = await sched.seedWaitlistEntry(t, patientId, ymd(3));
      const args = sched.promoteArgs(t, entryId, nextFreeSlot());
      return () => receptionist.client.rpc("promote_waitlist_entry", args);
    });

    // ---- INVOKER reads on the same stack: the baselines --------------------------------------------------------------------------
    // Visits for the reads to find, and one patient with a name no other patient shares: the search is a selective typeahead (a few
    // rows), as a receptionist types it, not a query that every seeded patient matches.
    for (let i = 0; i < 20; i++) await seedVisit(t, undefined, { status: "completed" });
    await desk.seedPatient(t, { full_name: "Latencyfind Prober" });
    await measure("baseline: visits select", "baseline", async () => () => receptionist.client.from("visits").select("id, status, scheduled_at").limit(20));
    await measure("baseline: search_patients", "baseline", async () => () => receptionist.client.rpc("search_patients", { p_query: "Latencyfind", p_limit: 8 }));
    await measure("baseline: available_slots", "baseline", async () => () => receptionist.client.rpc("available_slots", { p_doctor_id: t.userId, p_date: ymd(4) }));

    // ---- V2-09b R-18: the Smart Assist reads on a synthetic seed: 2,000 catalogue rows, 300 signed visits of one doctor (the owner here), 50 of them
    // for one patient. The visits are signed through the command (a signed visit cannot be inserted), so this leg seeds about 1,200 rows before it times.
    const catalogue = Array.from({ length: 2000 }, (_, i) => ({
      name: `Latency diagnosis ${i} ${["fever", "cough", "pain", "infection", "syndrome"][i % 5]}`,
      icd11_code: null,
      synonyms: [`ld${i}`, `latency alias ${i}`],
      specialties: ["general_physician"],
      is_chronic: i % 7 === 0,
    }));
    for (let i = 0; i < catalogue.length; i += 500) {
      const { data, error } = await admin.from("opd_diagnoses").insert(catalogue.slice(i, i + 500)).select("id");
      if (error) throw new Error(`catalogue seed failed: ${error.message}`);
      catalogueIds.push(...(data ?? []).map((r) => r.id));
    }
    // V2-09c 09C-01 (R-17): a catalogue of 20,000 synthetic CDCI rows for the medicine search (the global fixture rows are removed in `finally`). The names are
    // pseudo-random words (a hash mapped to letters), like a real catalogue's, so a doctor's four or five typed letters match a handful of rows, not all of them.
    for (let i = 0; i < 20_000; i += 1000) {
      const chunk = Array.from({ length: 1000 }, (_, j) => {
        const n = i + j + 1;
        return {
          id: `test-cdci-09c-lat-${String(n).padStart(6, "0")}`,
          brand_name: `${latencyWord(n, 9)} ${(n % 900) + 100}`,
          generic_name: `${latencyWord(n * 7, 10)}ol`,
          dose_form: ["Tablet", "Syrup", "Capsule"][n % 3],
          product_name: `p${n}`,
          supplier_name: "Synthetic Labs",
        };
      });
      const { error } = await admin.from("cdci_medicines_search").upsert(chunk, { onConflict: "id" });
      if (error) throw new Error(`CDCI seed failed: ${error.message}`);
    }
    // 2,000 synthetic CDCI substances (about a real catalogue's size) for the allergy typeahead; removed in `finally`.
    for (let i = 0; i < 2000; i += 500) {
      const chunk = Array.from({ length: 500 }, (_, j) => ({ id: `test-sub-09c-lat-${String(i + j + 1).padStart(5, "0")}`, substance_name: `${latencyWord(i + j + 1, 9)}ine` }));
      const { error } = await admin.from("cdci_substances").upsert(chunk, { onConflict: "id" });
      if (error) throw new Error(`substance seed failed: ${error.message}`);
    }
    const hotPatient = await desk.seedPatient(t);
    // The first signed visit of the hot patient: the source of "Same as last visit" below (a diagnosis and three lines).
    let hotSource = "";
    const pool: string[] = [];
    for (let i = 0; i < 30; i++) pool.push(await desk.seedPatient(t));
    const complaints = ["Fever", "Cough", "Headache", "Body ache", "Cold"];
    for (let i = 0; i < 300; i++) {
      // 50 visits for one patient (the snapshot's), the rest spread over 30 patients (a fresh seed has no planner statistics yet, and 250 visits of one patient
      // would make the diagnosis join scan that patient's rows 250 times, which a real clinic's history never does; thousands of new patients would exhaust the
      // local connection pool).
      const patientId = i < 50 ? hotPatient : pool[i % pool.length]!;
      const { data: visit, error: visitError } = await admin
        .from("visits")
        .insert({ tenant_id: t.tenantId, patient_id: patientId, doctor_id: t.userId, origin_type: "walk_in", status: "in_consultation", created_by: t.userId })
        .select("id")
        .single();
      if (visitError || !visit) throw new Error(`signed-history seed failed: ${visitError?.message}`);
      const notes = await admin
        .from("clinical_notes")
        .update({
          clinical_notes: "Synthetic latency note",
          chief_complaints: [{ symptom: complaints[i % 5], duration_val: 2, duration_unit: "days" }, { symptom: complaints[(i + 2) % 5], duration_val: 1, duration_unit: "days" }],
          investigations_advised: ["CBC", `Test ${i % 6}`],
          advice: [`Advice ${i % 4}`],
        })
        .eq("visit_id", visit.id);
      if (notes.error) throw new Error(`signed-history seed failed: ${notes.error.message}`);
      const dx = await admin
        .from("consultation_diagnoses")
        .insert({ tenant_id: t.tenantId, visit_id: visit.id, patient_id: patientId, diagnosis_name: `Latency history diagnosis ${i % 14}`, icd11_code: "ZZ00" });
      if (dx.error) throw new Error(`signed-history seed failed: ${dx.error.message}`);
      // V2-09c 09C-03 (R-17): three prescription lines per visit (a pool of 25 medicines, so the favourites rank real counts), written on the draft and sealed by the sign-off.
      const header = await admin
        .from("prescriptions")
        .insert({ tenant_id: t.tenantId, visit_id: visit.id, patient_id: patientId, doctor_id: t.userId, version: 1, status: "active" })
        .select("id")
        .single();
      if (header.error || !header.data) throw new Error(`signed-history seed failed: ${header.error?.message}`);
      const lines = await admin.from("prescription_items").insert(
        [0, 1, 2].map((n) => ({
          tenant_id: t.tenantId,
          prescription_id: header.data.id,
          medicine_name: `Latency Rx Medicine ${(i * 3 + n) % 25}`,
          dosage: n === 0 ? "1-0-1" : "0-0-1",
          timing: n === 2 ? null : "After food",
          duration: `${3 + (n % 3)} days`,
          sort_order: n,
        })),
      );
      if (lines.error) throw new Error(`signed-history seed failed: ${lines.error.message}`);
      if (i === 0) hotSource = visit.id;
      const signed = await owner.client.rpc("sign_consultation", clinical.signArgs(t, visit.id));
      if (signed.error) throw new Error(`signed-history seed failed: ${signed.error.message}`);
    }
    // A table that was just filled has no planner statistics (the reads then plan badly, and the figure measures that, not the query). Autovacuum's
    // ANALYZE runs within its 60 s nap; a clinic's tables have had it for a long time.
    console.log("[latency] waiting 75 s for autovacuum to analyze the seeded tables");
    await new Promise((resolve) => setTimeout(resolve, 75_000));
    // V2-09c 09C-03 (R-10): "Same as last visit" onto a fresh draft of the same patient: the diagnosis and the three lines copied, with allergies recorded so the check runs.
    await admin.from("patients").update({ allergies: ["Latency allergen", "Latency substance 7", "Penicillin"] }).eq("id", hotPatient);
    await measure("repeat_visit_plan", "command", async () => {
      const { data: target, error: targetError } = await admin
        .from("visits")
        .insert({ tenant_id: t.tenantId, patient_id: hotPatient, doctor_id: t.userId, origin_type: "walk_in", status: "in_consultation", created_by: t.userId })
        .select("id")
        .single();
      if (targetError || !target) throw new Error(`repeat target seed failed: ${targetError?.message}`);
      const args = { p_tenant_id: t.tenantId, p_visit_id: target.id, p_source_visit_id: hotSource, p_parts: ["diagnoses", "prescription"], p_client_request_id: randomUUID() };
      return () => owner.client.rpc("repeat_visit_plan", args);
    });
    // consult_assist_context with the Rx keys: the doctor's 300 signed visits of three lines each (25 distinct medicines).
    await measure("read: consult_assist_context", "read", async () => () => owner.client.rpc("consult_assist_context", { p_tenant_id: t.tenantId }));
    await measure("read: search_diagnoses", "read", async (i) => () =>
      owner.client.rpc("search_diagnoses", { p_tenant_id: t.tenantId, p_terms: [`latency diagnosis ${(i * 13) % 2000}`, "latency fever"], p_specialty: "general_physician", p_limit: 12 }),
    );
    await measure("read: search_medicines", "read", async (i) => () =>
      // What a doctor types: the first four or five letters of a brand or of a generic, and sometimes a word and its number.
      owner.client.rpc("search_medicines", {
        p_tenant_id: t.tenantId,
        p_query: [
          latencyWord(((i * 37) % 20_000) + 1, 9).slice(0, 5),
          latencyWord((((i * 53) % 20_000) + 1) * 7, 10).slice(0, 4),
          `${latencyWord(((i * 71) % 20_000) + 1, 9).slice(0, 6)} ${(((i * 71) % 20_000) % 900) + 100}`,
        ][i % 3].toLowerCase(),
        p_limit: 15,
      }),
    );
    await measure("read: search_substances", "read", async (i) => () =>
      owner.client.rpc("search_substances", { p_tenant_id: t.tenantId, p_query: latencyWord(((i * 41) % 2000) + 1, 9).slice(0, 4).toLowerCase(), p_limit: 12 }),
    );
    // V2-09e 09E-09 (R-5, R-16): the substance shard the device downloads (the whole catalogue in one call: the 2,000 synthetic substances above plus the stack's own).
    await measure("read: reference_shard (substances)", "read", async () => () => owner.client.rpc("reference_shard", { p_tenant_id: t.tenantId, p_catalogue: "substances", p_shard: 0 }));
    // The context of one visit with an allergic patient and three prescription lines.
    const ctxVisit = await seedVisit(t, undefined, { status: "in_consultation" });
    await admin.from("patients").update({ allergies: ["Latency substance 7", "Latency allergen", "Penicillin"] }).eq("id", ctxVisit.patientId);
    const ctxAdd = await owner.client.rpc("change_prescription", {
      p_tenant_id: t.tenantId,
      p_visit_id: ctxVisit.visitId,
      p_changes: { add: [1, 2, 3].map((n) => ({ medicine_name: `Latency context line ${n}`, dosage: "1-0-1", duration: "5 days" })) },
      p_client_request_id: randomUUID(),
    });
    if (ctxAdd.error) throw new Error(`context seed failed: ${ctxAdd.error.message}`);
    await measure("read: rx_allergy_context", "read", async () => () => owner.client.rpc("rx_allergy_context", { p_tenant_id: t.tenantId, p_visit_id: ctxVisit.visitId }));
    await measure("read: patient_snapshot", "read", async () => () =>
      owner.client.rpc("patient_snapshot", { p_tenant_id: t.tenantId, p_patient_id: hotPatient }),
    );
    // V2-09e 09E-05 (R-8, R-9): the consult in one read, on the heaviest draft: the hot patient's 50 signed visits (history), the doctor's learned order from 300
    // signed visits, three prescription lines, and the doctor's own lists at their caps (500 custom medicines, 500 custom diagnoses, 100 templates, 200 macros).
    const screenVisit = await seedVisit(t, undefined, { status: "in_consultation" });
    await admin.from("visits").update({ patient_id: hotPatient }).eq("id", screenVisit.visitId);
    const screenAdd = await owner.client.rpc("change_prescription", {
      p_tenant_id: t.tenantId,
      p_visit_id: screenVisit.visitId,
      p_changes: { add: [1, 2, 3].map((n) => ({ medicine_name: `Latency screen line ${n}`, dosage: "1-0-1", duration: "5 days" })) },
      p_client_request_id: randomUUID(),
    });
    if (screenAdd.error) throw new Error(`consult_screen seed failed: ${screenAdd.error.message}`);
    const listRows = (n: number, make: (i: number) => Record<string, unknown>) => Array.from({ length: n }, (_, i) => ({ tenant_id: t.tenantId, doctor_id: t.userId, ...make(i + 1) }));
    for (const [table, rows] of [
      ["doctor_custom_medicines", listRows(500, (i) => ({ medicine_name: `Latency custom medicine ${i}`, default_dosage: "1-0-1", use_count: 1 + (i % 17) }))],
      ["doctor_custom_diagnoses", listRows(500, (i) => ({ diagnosis_name: `Latency custom diagnosis ${i}`, use_count: 1 + (i % 11) }))],
      ["doctor_prescription_templates", listRows(100, (i) => ({ template_name: `Latency template ${i}`, items: [1, 2, 3].map((n) => ({ medicine_name: `Latency template line ${n}`, dosage: "1-0-1", duration: "5 days", sort_order: n - 1 })) }))],
      ["doctor_text_macros", listRows(200, (i) => ({ shortcut: `.lat${i}`, expansion: `Latency macro expansion ${i}` }))],
    ] as const) {
      const { error } = await admin.from(table).insert(rows as never);
      if (error) throw new Error(`consult_screen list seed (${table}) failed: ${error.message}`);
    }
    await measure("read: consult_screen", "read", async () => () => owner.client.rpc("consult_screen", { p_tenant_id: t.tenantId, p_visit_id: screenVisit.visitId }));
    // V2-09e 09E-06 (R-9, R-12): Today's board in one read, on a busy day: every visit this run made today (walk-ins in every state, signed visits, invoices and payments,
    // follow-ups), the owner's role (every part: allergy flag, vitals, invoice, follow-up).
    await measure("read: today_board", "read", async () => () => owner.client.rpc("today_board", { p_tenant_id: t.tenantId, p_mode: "front" }));
    // V2-09e H-1 (000129, R-16): the medicine shards the device downloads, on the full-size synthetic catalogue (93,911 brands, 10,305 generics; the lane's
    // perf-* rows, deleted in `finally`). The first brand shard and the last one (OFFSET 84,000: the shard that timed out under 000128).
    const { upsertPerfCatalogue } = await import("../../tests/e2e/support/perf-catalogue");
    perfCatalogueLoaded = true;
    await upsertPerfCatalogue(admin);
    const shardOf = async (shard: number) => {
      const { data, error } = await owner.client.rpc("reference_shard", { p_tenant_id: t.tenantId, p_catalogue: "medicines", p_shard: shard });
      if (error) throw new Error(`reference_shard ${shard}: ${error.message}`);
      return data as { shards: number; rows: unknown[] };
    };
    const lastShard = (await shardOf(0)).shards - 1;
    if (lastShard < 8) throw new Error(`the full-size catalogue should give at least 8 brand shards, got ${lastShard}`);
    await measure("reference: reference_shard (medicines, first brand shard, full size)", "reference", async () => () =>
      owner.client.rpc("reference_shard", { p_tenant_id: t.tenantId, p_catalogue: "medicines", p_shard: 1 }),
    );
    await measure(`reference: reference_shard (medicines, last brand shard ${lastShard}, full size)`, "reference", async () => () =>
      owner.client.rpc("reference_shard", { p_tenant_id: t.tenantId, p_catalogue: "medicines", p_shard: lastShard }),
    );
  } finally {
    if (perfCatalogueLoaded) {
      const { deletePerfCatalogue } = await import("../../tests/e2e/support/perf-catalogue");
      await deletePerfCatalogue(admin).catch((error: unknown) => console.error(`[latency] cleanup: deleting the perf catalogue failed: ${error instanceof Error ? error.message : String(error)}`));
    }
    // Remove what this run made (the catalogue rows; the clinic cascades; then the two users).
    for (let i = 0; i < catalogueIds.length; i += 100) {
      const { error } = await admin.from("opd_diagnoses").delete().in("id", catalogueIds.slice(i, i + 100));
      if (error) console.error(`[latency] cleanup: deleting the synthetic catalogue rows failed: ${error.message}`);
    }
    const subs = await admin.from("cdci_substances").delete().like("id", "test-sub-09c-lat-%");
    if (subs.error) console.error(`[latency] cleanup: deleting the synthetic substances failed: ${subs.error.message}`);
    const cdci = await admin.from("cdci_medicines_search").delete().like("id", "test-cdci-09c-lat-%");
    if (cdci.error) console.error(`[latency] cleanup: deleting the synthetic CDCI rows failed: ${cdci.error.message}`);
    const { error: tenantError } = await admin.from("tenants").delete().eq("id", owner.tenantId);
    if (tenantError) console.error(`[latency] cleanup: deleting the synthetic clinic failed: ${tenantError.message}`);
    for (const id of [owner.userId, receptionist.userId]) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) console.error(`[latency] cleanup: deleting a synthetic user failed: ${error.message}`);
    }
  }

  const baseline = rows.find((r) => r.name === "baseline: visits select");
  const result: LatencyRow[] = rows.map((r) => ({
    ...r,
    p95_over_baseline: baseline && baseline.p95_ms > 0 ? round1(r.p95_ms / baseline.p95_ms) : null,
  }));
  const over = result.filter(
    (r) => (r.kind === "command" && r.p95_ms >= TARGET_MS) || (r.kind === "read" && r.p95_ms >= READ_TARGET_MS) || (r.kind === "reference" && r.p95_ms >= REFERENCE_TARGET_MS),
  );
  const report = {
    description:
      "p50, p95 and p99 of one supabase-js round trip (PostgREST, local Supabase stack) per command, sequential calls with fresh request ids and prepared rows; the baselines are plain INVOKER reads on the same stack",
    target_p95_ms: TARGET_MS,
    read_target_p95_ms: READ_TARGET_MS,
    reference_target_p95_ms: REFERENCE_TARGET_MS,
    calls_per_command: callsPerCommand,
    warmup_calls_not_counted: WARMUP,
    node: process.version,
    cpu_count: os.cpus().length,
    passed: !failed && over.length === 0,
    commands_over_target: over.map((r) => r.name),
    results: result,
  };
  if (out) {
    const file = path.resolve(ROOT, out);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[latency] wrote ${path.relative(ROOT, file)}`);
  }
  if (over.length > 0) console.error(`[latency] p95 over its target (${TARGET_MS} ms a command, ${READ_TARGET_MS} ms a Smart Assist read): ${over.map((r) => `${r.name} (${r.p95_ms} ms)`).join(", ")}`);
  if (!report.passed) process.exit(1);
  console.log(`[latency] PASS: every command p95 is under ${TARGET_MS} ms and every Smart Assist read under ${READ_TARGET_MS} ms`);
}

main().catch((error: unknown) => {
  console.error(`[latency] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
