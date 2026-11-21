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
 * the target. Output: p50, p95, p99 per call, the ratio of the command's p95 to the baseline's, the node version and the CPU
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
import { randomUUID } from "node:crypto";
import { assertLocalTestEnv, loadLocalStackKeys, loadTestEnv } from "../../tests/setup/test-env";

const ROOT = path.resolve(__dirname, "../..");
const TARGET_MS = 150;
const WARMUP = 5;

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

export interface LatencyRow {
  name: string;
  kind: "command" | "baseline";
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
  let failed = false;

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
      const args = clinical.reopenArgs(t, visitId);
      return () => owner.client.rpc("reopen_visit_for_amendment", args);
    });
    await measure("finalize_visit_amendment", "command", async () => {
      const { visitId } = await clinical.seedClinicalVisit(t);
      const signed = await owner.client.rpc("sign_consultation", clinical.signArgs(t, visitId));
      if (signed.error) throw new Error(`prepare finalize: sign failed: ${signed.error.message}`);
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
  } finally {
    // Remove what this run made (the clinic cascades; then the two users).
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
  const over = result.filter((r) => r.kind === "command" && r.p95_ms >= TARGET_MS);
  const report = {
    description:
      "p50, p95 and p99 of one supabase-js round trip (PostgREST, local Supabase stack) per command, sequential calls with fresh request ids and prepared rows; the baselines are plain INVOKER reads on the same stack",
    target_p95_ms: TARGET_MS,
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
  if (over.length > 0) console.error(`[latency] p95 at or above ${TARGET_MS} ms: ${over.map((r) => `${r.name} (${r.p95_ms} ms)`).join(", ")}`);
  if (!report.passed) process.exit(1);
  console.log(`[latency] PASS: every command p95 is under ${TARGET_MS} ms`);
}

main().catch((error: unknown) => {
  console.error(`[latency] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
