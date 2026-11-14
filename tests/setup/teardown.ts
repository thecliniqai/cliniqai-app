/**
 * Run-scoped teardown for the local test lane (V2-01a plan 01a-03, TEST_STRATEGY E-2 / T-02).
 *
 * A "run" is everything created on the local stack after the run started, measured on the server's clock. That
 * catches rows created by helpers, by specs directly, and by RPCs (e.g. `create_clinic_with_owner`), without
 * relying on names or email patterns. One run per local stack: `startRun` takes a lock and fails fast if
 * another run holds it, so one run's teardown can never delete another run's data. Order (migration FK graph):
 *   1. leak check, BEFORE anything is deleted — 23 columns reference `auth.users` with NO ACTION; a run user
 *      referenced from a tenant outside the run means a cross-tenant write (isolation bug): fail loudly, delete
 *      nothing, keep everything for inspection;
 *   2. storage objects under each run tenant's prefixes (no FK ties them to rows, so the cascade misses them);
 *   3. `DELETE FROM tenants` — every tenant-scoped table cascades from `tenants`;
 *   4. delete run auth users (memberships, sessions and identities cascade);
 *   5. verify nothing created during the run remains.
 * `session_replication_role = replica` is never used: it disables the FK triggers that implement the cascade.
 *
 * Not covered (accepted, synthetic and idempotent): fixture rows a spec upserts into global reference tables
 * (e.g. `test-cdci-*` in `cdci_medicines_search`). A run that is killed before teardown leaves its data;
 * `npx supabase db reset --local` clears it.
 *
 * Only ever runs after `assertLocalTestEnv()` has passed, with the local service-role key.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertLocalTestEnv } from "./test-env";
import { psql } from "../helpers/sql";

/** Columns referencing auth.users with NO ACTION (migrations 000002–000013); checked against the live catalog by
 * tests/setup/teardown.spec.ts so the list cannot drift. Every one of these tables has `tenant_id`. */
export const NO_ACTION_USER_REFS: ReadonlyArray<readonly [table: string, column: string]> = [
  ["invitations", "created_by"],
  ["invitations", "consumed_by"],
  ["patients", "created_by"],
  ["audit_logs", "actor_id"],
  ["consent_records", "recorded_by"],
  ["consultations", "doctor_id"],
  ["visits", "doctor_id"],
  ["visits", "created_by"],
  ["visits", "signed_by"],
  ["waitlist_entries", "doctor_id"],
  ["waitlist_entries", "created_by"],
  ["prescriptions", "doctor_id"],
  ["doctor_custom_medicines", "doctor_id"],
  ["doctor_custom_diagnoses", "doctor_id"],
  ["doctor_prescription_templates", "doctor_id"],
  ["visit_revisions", "amended_by"],
  ["follow_ups", "doctor_id"],
  ["payments", "recorded_by"],
  ["patient_documents", "uploaded_by"],
  ["document_share_tokens", "created_by"],
  ["referrals", "referring_doctor_id"],
  ["referrals", "closed_by"],
  ["schedule_blocks", "created_by"],
];

/** Storage prefixes a tenant's objects live under (000008, 000013; pdf/labs/referral generators). */
export function tenantStoragePrefixes(tenantId: string): Array<{ bucket: string; prefix: string }> {
  return [
    { bucket: "prescriptions", prefix: tenantId },
    { bucket: "clinic-records", prefix: `tenants/${tenantId}` },
    { bucket: "clinic-records", prefix: tenantId },
  ];
}

/** Repo files the code under test writes as a side effect (git-ignored); removed if the run created them. */
export const SIDE_EFFECT_FILES = [".planning/dev-messages.txt"];

export interface RunMarker {
  /** ISO timestamp from the local stack's clock, slightly before the first test ran. */
  startedAt: string;
  /** Side-effect files that already existed before the run (left alone). */
  preexistingFiles: string[];
  /** Lock file held for the duration of the run. */
  lockFile: string;
}

export interface TeardownReport {
  tenants: number;
  users: number;
  storageObjects: number;
}

const CHUNK = 100;
/** Run tenants per leak-check request, next to a {@link CHUNK} of user ids: keeps the URL well under the 8 KB limit. */
const TENANT_CHUNK = 50;
function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function localAdminClient(env: NodeJS.ProcessEnv = process.env): SupabaseClient {
  assertLocalTestEnv(env);
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SECRET_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Server-clock time (from the local gateway's Date header) minus a small margin. */
export async function serverNow(env: NodeJS.ProcessEnv = process.env, marginMs = 2_000): Promise<string> {
  assertLocalTestEnv(env);
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`, {
    headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "" },
  });
  if (!res.ok) throw new Error(`Local stack health check failed (HTTP ${res.status}); is \`npx supabase start\` running?`);
  const date = res.headers.get("date");
  const ms = date ? Date.parse(date) : NaN;
  if (Number.isNaN(ms)) throw new Error("Local stack did not return a usable Date header; cannot mark the run start");
  return new Date(ms - marginMs).toISOString();
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** One test run per local stack. A lock left by a dead process is taken over. */
export function acquireRunLock(env: NodeJS.ProcessEnv = process.env): string {
  const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL!);
  const lockFile = path.join(os.tmpdir(), `clinicos-test-lane-${url.hostname.replace(/[^a-z0-9]/gi, "_")}-${url.port}.lock`);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(lockFile, String(process.pid), { flag: "wx" });
      return lockFile;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const holder = Number(fs.readFileSync(lockFile, "utf8"));
      if (Number.isInteger(holder) && holder > 0 && pidAlive(holder)) {
        throw new Error(
          `Another test run (pid ${holder}) is using the local stack at ${url.host}. Run one at a time: ` +
            "teardown deletes everything created during a run.",
        );
      }
      fs.rmSync(lockFile, { force: true });
    }
  }
  throw new Error(`Could not acquire the test-run lock ${lockFile}`);
}

export function releaseRunLock(lockFile: string): void {
  try {
    if (Number(fs.readFileSync(lockFile, "utf8")) === process.pid) fs.rmSync(lockFile, { force: true });
  } catch {
    // already gone
  }
}

export async function startRun(rootDir: string, env: NodeJS.ProcessEnv = process.env): Promise<RunMarker> {
  const lockFile = acquireRunLock(env);
  try {
    return {
      startedAt: await serverNow(env),
      preexistingFiles: SIDE_EFFECT_FILES.filter((f) => fs.existsSync(path.join(rootDir, f))),
      lockFile,
    };
  } catch (e) {
    releaseRunLock(lockFile);
    throw e;
  }
}

async function runTenantIds(admin: SupabaseClient, since: string, userIds: string[]): Promise<string[]> {
  const ids = new Set<string>();
  const { data, error } = await admin.from("tenants").select("id").gte("created_at", since);
  if (error) throw new Error(`teardown: listing run tenants failed: ${error.message}`);
  for (const row of data ?? []) ids.add(row.id as string);
  // Tenants reachable through run users' memberships (belt and braces for anything created outside the window).
  for (const part of chunks(userIds)) {
    const { data: m, error: mErr } = await admin.from("memberships").select("tenant_id").in("user_id", part);
    if (mErr) throw new Error(`teardown: listing run memberships failed: ${mErr.message}`);
    for (const row of m ?? []) ids.add(row.tenant_id as string);
  }
  // Never delete a tenant that predates the run: a pre-existing tenant joined by a run user is a leak, not run data.
  // Chunked like the leak checks: one `in` list of every run tenant id passes the gateway's URL limit (~200 ids).
  for (const part of chunks([...ids], TENANT_CHUNK)) {
    const { data: old, error: oErr } = await admin
      .from("tenants")
      .select("id")
      .in("id", part)
      .lt("created_at", since);
    if (oErr) throw new Error(`teardown: checking tenant ages failed: ${oErr.message}`);
    for (const row of old ?? []) ids.delete(row.id as string);
  }
  return [...ids];
}

async function runUserIds(admin: SupabaseClient, since: string): Promise<string[]> {
  const ids: string[] = [];
  const sinceMs = Date.parse(since);
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`teardown: listing auth users failed: ${error.message}`);
    for (const u of data.users) if (Date.parse(u.created_at) >= sinceMs) ids.push(u.id);
    if (data.users.length < 1000) break;
  }
  return ids;
}

async function listObjectsRecursive(admin: SupabaseClient, bucket: string, prefix: string): Promise<string[]> {
  const found: string[] = [];
  const queue = [prefix];
  while (queue.length) {
    const dir = queue.shift()!;
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await admin.storage.from(bucket).list(dir, { limit: 1000, offset });
      if (error) throw new Error(`teardown: listing ${bucket}/${dir} failed: ${error.message}`);
      for (const entry of data ?? []) {
        const full = `${dir}/${entry.name}`;
        // Folders come back with a null id; files have an id.
        if (entry.id === null) queue.push(full);
        else found.push(full);
      }
      if (!data || data.length < 1000) break;
    }
  }
  return found;
}

async function removeTenantObjects(admin: SupabaseClient, tenantIds: string[]): Promise<number> {
  let removed = 0;
  for (const tenantId of tenantIds) {
    for (const { bucket, prefix } of tenantStoragePrefixes(tenantId)) {
      const paths = await listObjectsRecursive(admin, bucket, prefix);
      for (const part of chunks(paths)) {
        const { error } = await admin.storage.from(bucket).remove(part);
        if (error) throw new Error(`teardown: removing objects from ${bucket} failed: ${error.message}`);
        removed += part.length;
      }
    }
  }
  return removed;
}

/**
 * Rows in tenants OUTSIDE the run that reference a run user through a NO ACTION column. Any hit means a run user
 * wrote into a tenant the run did not create.
 */
export async function findLeakedReferences(
  admin: SupabaseClient,
  userIds: string[],
  runTenantIds: string[],
): Promise<string[]> {
  const leaks: string[] = [];
  if (!userIds.length) return leaks;
  // Rows outside the run = rows of run users (tenant set) minus rows in run tenants. Counted per bounded chunk: one
  // `not tenant_id in (<every run tenant>)` filter outgrows the gateway's URL limit (HTTP 414 with an empty body)
  // once a run creates about 200 tenants (V2-03 03-07).
  const count = async (table: string, column: string, users: string[], tenants?: string[]): Promise<number> => {
    let q = admin.from(table).select("*", { count: "exact", head: true }).in(column, users);
    q = tenants ? q.in("tenant_id", tenants) : runTenantIds.length ? q.not("tenant_id", "is", null) : q;
    const { count: n, error } = await q;
    if (error) {
      throw new Error(`teardown: leak check on ${table}.${column} failed: ${error.message || `HTTP ${error.code || "error"}`}`);
    }
    return n ?? 0;
  };
  for (const [table, column] of NO_ACTION_USER_REFS) {
    let total = 0;
    for (const part of chunks(userIds)) {
      total += await count(table, column, part);
      for (const tenants of chunks(runTenantIds, TENANT_CHUNK)) total -= await count(table, column, part, tenants);
    }
    if (total) leaks.push(`${table}.${column}: ${total} row(s)`);
  }
  return leaks;
}

export async function teardownRun(
  rootDir: string,
  marker: RunMarker,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TeardownReport> {
  const admin = localAdminClient(env);
  const userIds = await runUserIds(admin, marker.startedAt);
  const tenantIds = await runTenantIds(admin, marker.startedAt, userIds);

  const leaks = await findLeakedReferences(admin, userIds, tenantIds);
  if (leaks.length) {
    throw new Error(
      "teardown: run users are referenced by rows in tenants outside the run (possible cross-tenant write). " +
        "Nothing was deleted; inspect, then `npx supabase db reset --local`.\n  " +
        leaks.join("\n  "),
    );
  }

  const storageObjects = await removeTenantObjects(admin, tenantIds);

  for (const part of chunks(tenantIds)) {
    const { error } = await admin.from("tenants").delete().in("id", part);
    if (error) throw new Error(`teardown: deleting run tenants failed: ${error.message}`);
  }

  for (const id of userIds) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) throw new Error(`teardown: deleting a run auth user failed: ${error.message}`);
  }

  // Verify: nothing created during the run is left.
  const { count: tenantsLeft, error: tErr } = await admin
    .from("tenants")
    .select("*", { count: "exact", head: true })
    .gte("created_at", marker.startedAt);
  if (tErr) throw new Error(`teardown: verification failed: ${tErr.message}`);
  const usersLeft = (await runUserIds(admin, marker.startedAt)).length;
  let objectsLeft = 0;
  for (const tenantId of tenantIds) {
    for (const { bucket, prefix } of tenantStoragePrefixes(tenantId)) {
      objectsLeft += (await listObjectsRecursive(admin, bucket, prefix)).length;
    }
  }
  if (tenantsLeft || usersLeft || objectsLeft) {
    throw new Error(
      `teardown: run data remains after teardown (tenants ${tenantsLeft}, users ${usersLeft}, objects ${objectsLeft})`,
    );
  }

  // V2-04 04-03c: the inbound dedupe store (ops.inbound_webhook_events) has no tenant, so tenant deletion does not
  // reach it. Remove the keys this run recorded (the Send Email hook and MSG91 route calls of every spec); no worker is
  // running any more, so nothing races this. Keys only (provider, id, timestamps): no personal data either way.
  if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(marker.startedAt)) throw new Error("teardown: unexpected run marker");
  psql(`delete from ops.inbound_webhook_events where received_at >= '${marker.startedAt}'::timestamptz`);

  for (const file of SIDE_EFFECT_FILES) {
    if (!marker.preexistingFiles.includes(file)) fs.rmSync(path.join(rootDir, file), { force: true });
  }

  return { tenants: tenantIds.length, users: userIds.length, storageObjects };
}
