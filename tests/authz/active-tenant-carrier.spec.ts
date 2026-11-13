/**
 * Active-tenant carrier tracer (V2-05 05-01b step 0, ruling R-42, threat T-05-39; V2-03 03-07 D1 finding 2).
 *
 * The app's user client (`lib/supabase/server.ts` `createClient()`) sends `x-clinicos-tenant` from the
 * `clinic_active_tenant` cookie; `authz.active_tenant_id()` (migration 000046) reads it from `request.headers` and
 * binds every helper to that clinic. This spec drives the REAL `createClient()` (only `next/headers` is replaced by an
 * in-memory cookie jar, filled by a real password sign-in through the same client) against the local stack, for a
 * user who is a doctor in clinic A and a receptionist in clinic B:
 *   (a) PostgREST: `rpc("has_permission")` for B is false with A active and true with B active;
 *   (b) Storage: a throwaway bucket with a temporary `storage.objects` SELECT policy on `authz.full_tenant_ids()`
 *       serves B's object only with B active (and A's only with A active);
 *   (c) no cookie with two memberships: nothing in either clinic, through both PostgREST and Storage.
 * Plus the single-clinic fallback (no cookie, one membership -> that clinic). Synthetic data only.
 */
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getAdminClient } from "../helpers/supabase-admin";
import { createDualMembershipUser, seedTenantWithOwner, seededUserPassword, type SeededTenant } from "../helpers/tenants";
import { psql } from "../helpers/sql";

interface JarCookie {
  name: string;
  value: string;
}

/** The cookie jar `next/headers` `cookies()` returns while a case runs. */
const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));

vi.mock("next/headers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/headers")>();
  const store = {
    get: (name: string): JarCookie | undefined =>
      jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined,
    getAll: (): JarCookie[] => [...jar.cookies].map(([name, value]) => ({ name, value })),
    has: (name: string) => jar.cookies.has(name),
    set: (name: string, value: string) => {
      jar.cookies.set(name, value);
    },
    delete: (name: string) => {
      jar.cookies.delete(name);
    },
  };
  return { ...actual, cookies: async () => store };
});

const { createClient, ACTIVE_TENANT_COOKIE, activeTenantHeaders } = await import("@/lib/supabase/server");

const admin = getAdminClient();
const BUCKET = `authz-tracer-${randomBytes(4).toString("hex")}`;
const POLICY = `authz_tracer_${BUCKET.slice(-8)}_select`;

let ownerA: SeededTenant;
let ownerB: SeededTenant;
let dualEmail: string;
/** Session cookies of the dual member, captured once from a real sign-in through `createClient()`. */
let dualSession: Map<string, string>;
/** Session cookies of the single-clinic owner of A. */
let ownerASession: Map<string, string>;

async function signInThroughApp(email: string): Promise<Map<string, string>> {
  jar.cookies = new Map();
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password: seededUserPassword() });
  if (error) throw new Error(`sign-in failed: ${error.message}`);
  if (![...jar.cookies.keys()].some((k) => k.startsWith("sb-"))) throw new Error("sign-in wrote no session cookie");
  return new Map(jar.cookies);
}

/** The app's user client for `session`, with `clinic_active_tenant` = `active` (or no such cookie). */
async function appClientActingIn(session: Map<string, string>, active: string | null) {
  jar.cookies = new Map(session);
  if (active) jar.cookies.set(ACTIVE_TENANT_COOKIE, active);
  return createClient();
}

async function hasPermission(session: Map<string, string>, active: string | null, tenant: string, perm: string) {
  const supabase = await appClientActingIn(session, active);
  const { data, error } = await supabase.rpc("has_permission", { p_tenant: tenant, p_perm: perm });
  if (error) throw new Error(`has_permission failed: ${error.message}`);
  return data;
}

/** True when the app's client acting in `active` can download `path` from the tracer bucket. */
async function canRead(session: Map<string, string>, active: string | null, path: string): Promise<boolean> {
  const supabase = await appClientActingIn(session, active);
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  return !error && data !== null;
}

const objectOf = (tenantId: string) => `${tenantId}/tracer.txt`;

beforeAll(async () => {
  ownerA = await seedTenantWithOwner(`Tracer A ${Date.now()}`);
  ownerB = await seedTenantWithOwner(`Tracer B ${Date.now()}`);
  const dual = await createDualMembershipUser(ownerA.tenantId, "doctor", ownerB.tenantId, "receptionist");
  dualEmail = dual.userEmail;

  // Throwaway bucket + a temporary policy that admits a folder only when it is the caller's active (full) tenant.
  const { error: bucketError } = await admin.storage.createBucket(BUCKET, { public: false });
  if (bucketError) throw new Error(`tracer bucket failed: ${bucketError.message}`);
  psql(
    `create policy ${POLICY} on storage.objects for select to authenticated using (` +
      `bucket_id = '${BUCKET}' and (storage.foldername(name))[1] in (select t::text from authz.full_tenant_ids() t))`,
  );
  for (const tenantId of [ownerA.tenantId, ownerB.tenantId]) {
    const { error } = await admin.storage
      .from(BUCKET)
      .upload(objectOf(tenantId), new Blob(["synthetic tracer object"], { type: "text/plain" }));
    if (error) throw new Error(`tracer upload failed: ${error.message}`);
  }

  dualSession = await signInThroughApp(dualEmail);
  ownerASession = await signInThroughApp(ownerA.userEmail);
}, 60_000);

afterAll(async () => {
  psql(`drop policy if exists ${POLICY} on storage.objects`);
  await admin.storage.from(BUCKET).remove([objectOf(ownerA.tenantId), objectOf(ownerB.tenantId)]);
  const { error } = await admin.storage.deleteBucket(BUCKET);
  if (error) throw new Error(`tracer bucket cleanup failed: ${error.message}`);
});

describe("the app client carries the active clinic (R-42)", () => {
  it("sends the header only for a UUID-shaped cookie", () => {
    expect(activeTenantHeaders(ownerA.tenantId)).toEqual({ "x-clinicos-tenant": ownerA.tenantId });
    expect(activeTenantHeaders(undefined)).toEqual({});
    expect(activeTenantHeaders("not-a-uuid")).toEqual({});
    expect(activeTenantHeaders(`${ownerA.tenantId}'`)).toEqual({});
  });

  it("(a) PostgREST: has_permission follows the active clinic, not every membership", async () => {
    // Acting in A (doctor): B is not the active clinic, so nothing in B; A's doctor keys hold.
    expect(await hasPermission(dualSession, ownerA.tenantId, ownerB.tenantId, "patients:view")).toBe(false);
    expect(await hasPermission(dualSession, ownerA.tenantId, ownerA.tenantId, "consultations:edit")).toBe(true);
    // Acting in B (receptionist, PO-3 keys): B's receptionist keys hold, A is out of scope.
    expect(await hasPermission(dualSession, ownerB.tenantId, ownerB.tenantId, "patients:view")).toBe(true);
    expect(await hasPermission(dualSession, ownerB.tenantId, ownerB.tenantId, "billing:collect")).toBe(true);
    expect(await hasPermission(dualSession, ownerB.tenantId, ownerB.tenantId, "consultations:edit")).toBe(false);
    expect(await hasPermission(dualSession, ownerB.tenantId, ownerA.tenantId, "consultations:edit")).toBe(false);
  });

  it("(b) Storage: a policy on authz.full_tenant_ids() sees the header", async () => {
    expect(await canRead(dualSession, ownerB.tenantId, objectOf(ownerB.tenantId))).toBe(true);
    expect(await canRead(dualSession, ownerA.tenantId, objectOf(ownerB.tenantId))).toBe(false);
    expect(await canRead(dualSession, ownerA.tenantId, objectOf(ownerA.tenantId))).toBe(true);
    expect(await canRead(dualSession, ownerB.tenantId, objectOf(ownerA.tenantId))).toBe(false);
  });

  it("(c) two memberships and no cookie: nothing in either clinic", async () => {
    expect(await hasPermission(dualSession, null, ownerA.tenantId, "patients:view")).toBe(false);
    expect(await hasPermission(dualSession, null, ownerB.tenantId, "patients:view")).toBe(false);
    expect(await canRead(dualSession, null, objectOf(ownerA.tenantId))).toBe(false);
    expect(await canRead(dualSession, null, objectOf(ownerB.tenantId))).toBe(false);
  });

  it("a cookie naming a clinic the user is not a member of selects nothing for a dual member", async () => {
    // A well-formed UUID of no clinic the dual member belongs to.
    const stranger = "00000000-0000-4000-8000-00000000dead";
    expect(await hasPermission(dualSession, stranger, ownerA.tenantId, "patients:view")).toBe(false);
    expect(await hasPermission(dualSession, stranger, ownerB.tenantId, "patients:view")).toBe(false);
  });

  it("the authz schema is not reachable through PostgREST (not an exposed schema, T-05-14)", async () => {
    const supabase = (await appClientActingIn(dualSession, ownerA.tenantId)) as unknown as SupabaseClient;
    const { data, error } = await supabase.schema("authz").rpc("active_tenant_id");
    expect(data).toBeNull();
    expect(error?.code).toBe("PGRST106");
  });

  it("a single-clinic user needs no cookie (sole-membership fallback), and a stale cookie does not lock them out", async () => {
    expect(await hasPermission(ownerASession, null, ownerA.tenantId, "clinic:manage")).toBe(true);
    expect(await canRead(ownerASession, null, objectOf(ownerA.tenantId))).toBe(true);
    expect(await canRead(ownerASession, null, objectOf(ownerB.tenantId))).toBe(false);
    // A cookie naming B (not theirs) cannot widen their reach and does not hide their own clinic.
    expect(await hasPermission(ownerASession, ownerB.tenantId, ownerB.tenantId, "patients:view")).toBe(false);
    expect(await hasPermission(ownerASession, ownerB.tenantId, ownerA.tenantId, "patients:view")).toBe(true);
    expect(await canRead(ownerASession, ownerB.tenantId, objectOf(ownerB.tenantId))).toBe(false);
  });
});
