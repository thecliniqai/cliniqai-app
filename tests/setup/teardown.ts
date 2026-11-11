/**
 * Run-scoped teardown for the local test lane (V2-01a plan 01a-03, TEST_STRATEGY E-2 / T-02).
 *
 * A "run" is everything created on the local stack after the run started, measured on the server's clock. That
 * catches rows created by helpers, by specs directly, and by RPCs (e.g. `create_clinic_with_owner`), without
 * relying on names or email patterns. Deletion order follows the migration FK graph (000001–000018):
 *   1. storage objects under each run tenant's prefixes (no FK ties them to rows, so the cascade misses them);
 *   2. `DELETE FROM tenants` — every tenant-scoped table cascades from `tenants`;
 *   3. leak check — 23 columns reference `auth.users` with NO ACTION; any remaining reference to a run user means
 *      a run user wrote into a tenant outside the run, which is an isolation bug, so teardown fails loudly;
 *   4. delete run auth users (memberships, sessions and identities cascade);
 *   5. verify nothing created during the run remains.
 * `session_replication_role = replica` is never used: it disables the FK triggers that implement the cascade.
 *
 * Only ever runs after `assertLocalTestEnv()` has passed, with the local service-role key.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertLocalTestEnv } from "./test-env";

/** Columns referencing auth.users without ON DELETE (migration FK graph, 000002–000013). */
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
export const SIDE_EFFECT_FILES = [".planning/dev-messages.txt", ".planning/dev-auth-logs.txt"];

export interface RunMarker {
  /** ISO timestamp from the local stack's clock, slightly before the first test ran. */
  startedAt: string;
  /** Side-effect files that already existed before the run (left alone). */
  preexistingFiles: string[];
}

export interface TeardownReport {
  tenants: number;
  users: number;
  storageObjects: number;
}

const CHUNK = 100;
function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function localAdminClient(env: NodeJS.ProcessEnv = process.env): SupabaseClient {
  assertLocalTestEnv(env);
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Server-clock time (from the local gateway's Date header) minus a small margin. */
export async function serverNow(env: NodeJS.ProcessEnv = process.env, marginMs = 2_000): Promise<string> {
  assertLocalTestEnv(env);
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`, {
    headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "" },
  });
  if (!res.ok) throw new Error(`Local stack health check failed (HTTP ${res.status}); is \`npx supabase start\` running?`);
  const date = res.headers.get("date");
  const ms = date ? Date.parse(date) : Date.now();
  return new Date(ms - marginMs).toISOString();
}

export async function startRun(rootDir: string, env: NodeJS.ProcessEnv = process.env): Promise<RunMarker> {
  return {
    startedAt: await serverNow(env),
    preexistingFiles: SIDE_EFFECT_FILES.filter((f) => fs.existsSync(path.join(rootDir, f))),
  };
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
  if (ids.size) {
    const { data: old, error: oErr } = await admin
      .from("tenants")
      .select("id")
      .in("id", [...ids])
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

async function assertNoLeakedReferences(admin: SupabaseClient, userIds: string[]): Promise<void> {
  const leaks: string[] = [];
  for (const [table, column] of NO_ACTION_USER_REFS) {
    let total = 0;
    for (const part of chunks(userIds)) {
      const { count, error } = await admin.from(table).select("*", { count: "exact", head: true }).in(column, part);
      if (error) throw new Error(`teardown: leak check on ${table}.${column} failed: ${error.message}`);
      total += count ?? 0;
    }
    if (total) leaks.push(`${table}.${column}: ${total} row(s)`);
  }
  if (leaks.length) {
    throw new Error(
      "teardown: run users are still referenced by rows outside the run's tenants (possible cross-tenant write). " +
        "Nothing further was deleted.\n  " +
        leaks.join("\n  "),
    );
  }
}

export async function teardownRun(
  rootDir: string,
  marker: RunMarker,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TeardownReport> {
  const admin = localAdminClient(env);
  const userIds = await runUserIds(admin, marker.startedAt);
  const tenantIds = await runTenantIds(admin, marker.startedAt, userIds);

  const storageObjects = await removeTenantObjects(admin, tenantIds);

  for (const part of chunks(tenantIds)) {
    const { error } = await admin.from("tenants").delete().in("id", part);
    if (error) throw new Error(`teardown: deleting run tenants failed: ${error.message}`);
  }

  await assertNoLeakedReferences(admin, userIds);

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

  for (const file of SIDE_EFFECT_FILES) {
    if (!marker.preexistingFiles.includes(file)) fs.rmSync(path.join(rootDir, file), { force: true });
  }

  return { tenants: tenantIds.length, users: userIds.length, storageObjects };
}
