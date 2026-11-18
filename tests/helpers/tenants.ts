import { createClient } from "@supabase/supabase-js";
import type { UserRole } from "@/lib/db/types";
import { publicEnv } from "@/lib/env";
import type { Database } from "@/types/database";
import type { TestDb } from "./db";
import { getAdminClient } from "./supabase-admin";
import { randomBytes } from "node:crypto";

// Per-run random password: seeded users never share a known credential (V2-00 / P2-04).
const TEST_PASSWORD = `T-${randomBytes(18).toString("base64url")}!9a`;

/** The per-run password of every seeded user (for password sign-in tests; never print it). */
export function seededUserPassword(): string {
  return TEST_PASSWORD;
}

export interface SeededTenant {
  tenantId: string;
  tenantName: string;
  userId: string;
  userEmail: string;
  role: UserRole;
  client: TestDb;
}

async function signInWithRetry(client: TestDb, email: string, password: string) {
  let attempts = 0;
  while (attempts < 5) {
    attempts++;
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (!error) return data;
    if (error.message.toLowerCase().includes("rate limit") && attempts < 5) {
      await new Promise((r) => setTimeout(r, 1000 * attempts));
      continue;
    }
    throw new Error(`Failed to authenticate user client: ${error.message}`);
  }
}

/**
 * Seeds a tenant with an owner user using the admin client,
 * then generates a session and returns an authenticated anon client
 * simulating the user's browser session.
 *
 * V2-05 05-09c (R-25, acceptance 11 preparation): the clinic's subscription is seeded `trialing` on the Standard
 * price (full access, the Standard trial entitlements) unless `subscription` says otherwise, so the clinic keeps full
 * access once the RLS helpers read the access level (05-10a). Pass `{ subscription: false }` to leave the row
 * `incomplete` (onboarding), as `create_clinic_with_owner` does.
 */
export async function seedTenantWithOwner(
  tenantName: string,
  options: { subscription?: SeedSubscriptionOptions | false } = {},
): Promise<SeededTenant> {
  const admin = getAdminClient();
  const email = `test-doctor-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;

  // 1. Create user via admin auth
  const password = TEST_PASSWORD;
  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (userError || !userData.user) {
    throw new Error(`Failed to create test user: ${userError?.message}`);
  }

  const userId = userData.user.id;

  // 2. Insert tenant
  const { data: tenantData, error: tenantError } = await admin
    .from("tenants")
    .insert({ name: tenantName })
    .select("id")
    .single();

  if (tenantError || !tenantData) {
    throw new Error(`Failed to create test tenant: ${tenantError?.message}`);
  }

  const tenantId = tenantData.id;

  // 3. Insert owner membership
  const { error: memError } = await admin.from("memberships").insert({
    user_id: userId,
    tenant_id: tenantId,
    role: "owner",
  });

  if (memError) {
    throw new Error(`Failed to create owner membership: ${memError.message}`);
  }

  // 4. The clinic's subscription (the tenants trigger created it `incomplete`; R-24).
  if (options.subscription !== false) await seedTenantSubscription(tenantId, options.subscription ?? {});

  // 5. Create authenticated anon client with user session
  const userClient = createClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );

  await signInWithRetry(userClient, email, password);

  return {
    tenantId,
    tenantName,
    userId,
    userEmail: email,
    role: "owner",
    client: userClient,
  };
}

/**
 * Creates a standalone authenticated user with zero clinic memberships.
 */
export async function createUnlinkedUser(): Promise<{
  userId: string;
  userEmail: string;
  client: TestDb;
}> {
  const admin = getAdminClient();
  const email = `unlinked-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;

  const password = TEST_PASSWORD;
  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (userError || !userData.user) {
    throw new Error(`Failed to create test user: ${userError?.message}`);
  }

  const userClient = createClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );

  await signInWithRetry(userClient, email, password);

  return {
    userId: userData.user.id,
    userEmail: email,
    client: userClient,
  };
}

/**
 * Adds a new user with a specific role to an existing tenant.
 */
export async function addMemberToTenant(
  tenantId: string,
  role: UserRole
): Promise<SeededTenant> {
  const admin = getAdminClient();
  const email = `member-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;

  const password = TEST_PASSWORD;
  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (userError || !userData.user) {
    throw new Error(`Failed to create test member user: ${userError?.message}`);
  }

  const userId = userData.user.id;

  const { error: memError } = await admin.from("memberships").insert({
    user_id: userId,
    tenant_id: tenantId,
    role,
  });

  if (memError) {
    throw new Error(`Failed to insert member: ${memError.message}`);
  }

  const userClient = createClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );

  await signInWithRetry(userClient, email, password);

  return {
    tenantId,
    tenantName: "Existing Clinic",
    userId,
    userEmail: email,
    role,
    client: userClient,
  };
}

export interface DualMemberUser {
  userId: string;
  userEmail: string;
  roleInA: UserRole;
  roleInB: UserRole;
  client: TestDb;
}

export interface DualTenantEcosystem {
  tenantA: {
    tenantId: string;
    tenantName: string;
    owner: SeededTenant;
    doctor: SeededTenant;
    patientId: string;
    consentId: string;
    auditLogId: number;
    invitationId: string;
    invitationToken: string;
  };
  tenantB: {
    tenantId: string;
    tenantName: string;
    owner: SeededTenant;
    doctor: SeededTenant;
    patientId: string;
    consentId: string;
    auditLogId: number;
    invitationId: string;
    invitationToken: string;
  };
  dualUser: DualMemberUser;
}

/**
 * Creates a single user with memberships in two distinct tenants.
 */
export async function createDualMembershipUser(
  tenantAId: string,
  roleA: UserRole,
  tenantBId: string,
  roleB: UserRole
): Promise<DualMemberUser> {
  const admin = getAdminClient();
  const email = `dual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;

  const password = TEST_PASSWORD;
  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (userError || !userData.user) {
    throw new Error(`Failed to create dual test user: ${userError?.message}`);
  }

  const userId = userData.user.id;

  // Insert membership for tenant A
  const { error: memAError } = await admin.from("memberships").insert({
    user_id: userId,
    tenant_id: tenantAId,
    role: roleA,
  });
  if (memAError) throw new Error(`Failed to bind dual user to tenant A: ${memAError.message}`);

  // Insert membership for tenant B
  const { error: memBError } = await admin.from("memberships").insert({
    user_id: userId,
    tenant_id: tenantBId,
    role: roleB,
  });
  if (memBError) throw new Error(`Failed to bind dual user to tenant B: ${memBError.message}`);

  const userClient = createClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );

  await signInWithRetry(userClient, email, password);

  return {
    userId,
    userEmail: email,
    roleInA: roleA,
    roleInB: roleB,
    client: userClient,
  };
}

/**
 * Builds two completely independent tenants (A and B), each with an owner,
 * a doctor staff member, representative records across all tenant-owned tables
 * (patients, consent_records, audit_logs, invitations; each clinic's tenant_subscriptions row is seeded `trialing`
 * by seedTenantWithOwner, V2-05 05-09c),
 * and one user with dual memberships across both tenants.
 */
export async function seedDualTenantEcosystem(): Promise<DualTenantEcosystem> {
  const admin = getAdminClient();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  // 1. Seed Tenant A & Tenant B with owners
  const ownerA = await seedTenantWithOwner(`Alpha Clinic ${suffix}`);
  const ownerB = await seedTenantWithOwner(`Beta Dental ${suffix}`);

  // 2. Add staff members to both
  const doctorA = await addMemberToTenant(ownerA.tenantId, "doctor");
  const doctorB = await addMemberToTenant(ownerB.tenantId, "doctor");

  // 3. Create dual-membership user (Doctor in A, Receptionist in B)
  const dualUser = await createDualMembershipUser(
    ownerA.tenantId,
    "doctor",
    ownerB.tenantId,
    "receptionist"
  );

  // 4. Seed Patients
  const { data: patientA, error: pAError } = await admin.from("patients")
    .insert({
      tenant_id: ownerA.tenantId,
      full_name: `Patient Alpha ${suffix}`,
      phone: `98765${Math.floor(10000 + Math.random() * 90000)}`,
      sex: "male",
      created_by: ownerA.userId,
    })
    .select("id")
    .single();
  if (pAError || !patientA) throw new Error(`Failed to seed patient A: ${pAError?.message}`);

  const { data: patientB, error: pBError } = await admin.from("patients")
    .insert({
      tenant_id: ownerB.tenantId,
      full_name: `Patient Beta ${suffix}`,
      phone: `91234${Math.floor(10000 + Math.random() * 90000)}`,
      sex: "female",
      created_by: ownerB.userId,
    })
    .select("id")
    .single();
  if (pBError || !patientB) throw new Error(`Failed to seed patient B: ${pBError?.message}`);

  // 5. Seed Consent Records
  const { data: consentA, error: cAError } = await admin.from("consent_records")
    .insert({
      tenant_id: ownerA.tenantId,
      patient_id: patientA.id,
      consent_type: "teleconsultation",
      status: "granted",
      recorded_by: ownerA.userId,
      note: "Ecosystem seed consent A",
    })
    .select("id")
    .single();
  if (cAError || !consentA) throw new Error(`Failed to seed consent A: ${cAError?.message}`);

  const { data: consentB, error: cBError } = await admin.from("consent_records")
    .insert({
      tenant_id: ownerB.tenantId,
      patient_id: patientB.id,
      consent_type: "data_sharing",
      status: "granted",
      recorded_by: ownerB.userId,
      note: "Ecosystem seed consent B",
    })
    .select("id")
    .single();
  if (cBError || !consentB) throw new Error(`Failed to seed consent B: ${cBError?.message}`);

  // 6. Seed Audit Logs
  const { data: auditA, error: audAError } = await admin.from("audit_logs")
    .insert({
      tenant_id: ownerA.tenantId,
      actor_id: ownerA.userId,
      actor_role: "owner",
      action: "patient.create",
      entity_type: "patient",
      entity_id: patientA.id,
      metadata: { source: "seed_dual_ecosystem" },
    })
    .select("id")
    .single();
  if (audAError || !auditA) throw new Error(`Failed to seed audit log A: ${audAError?.message}`);

  const { data: auditB, error: audBError } = await admin.from("audit_logs")
    .insert({
      tenant_id: ownerB.tenantId,
      actor_id: ownerB.userId,
      actor_role: "owner",
      action: "patient.create",
      entity_type: "patient",
      entity_id: patientB.id,
      metadata: { source: "seed_dual_ecosystem" },
    })
    .select("id")
    .single();
  if (audBError || !auditB) throw new Error(`Failed to seed audit log B: ${audBError?.message}`);


  // 7. Seed Invitations
  const crypto = await import("crypto");
  const rawTokenA = crypto.randomBytes(32).toString("hex");
  const tokenHashA = crypto.createHash("sha256").update(rawTokenA).digest("hex");
  const rawTokenB = crypto.randomBytes(32).toString("hex");
  const tokenHashB = crypto.createHash("sha256").update(rawTokenB).digest("hex");

  const { data: invA, error: invAError } = await admin.from("invitations")
    .insert({
      tenant_id: ownerA.tenantId,
      invited_address: `invited-a-${suffix}@example.com`,
      role: "receptionist",
      token_hash: tokenHashA,
      created_by: ownerA.userId,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    })
    .select("id")
    .single();
  if (invAError || !invA) throw new Error(`Failed to seed invitation A: ${invAError?.message}`);

  const { data: invB, error: invBError } = await admin.from("invitations")
    .insert({
      tenant_id: ownerB.tenantId,
      invited_address: `invited-b-${suffix}@example.com`,
      role: "doctor",
      token_hash: tokenHashB,
      created_by: ownerB.userId,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    })
    .select("id")
    .single();
  if (invBError || !invB) throw new Error(`Failed to seed invitation B: ${invBError?.message}`);

  return {
    tenantA: {
      tenantId: ownerA.tenantId,
      tenantName: ownerA.tenantName,
      owner: ownerA,
      doctor: doctorA,
      patientId: patientA.id,
      consentId: consentA.id,
      auditLogId: auditA.id,
      invitationId: invA.id,
      invitationToken: rawTokenA,
    },
    tenantB: {
      tenantId: ownerB.tenantId,
      tenantName: ownerB.tenantName,
      owner: ownerB,
      doctor: doctorB,
      patientId: patientB.id,
      consentId: consentB.id,
      auditLogId: auditB.id,
      invitationId: invB.id,
      invitationToken: rawTokenB,
    },
    dualUser,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Subscription rows for test clinics (V2-05 05-09c; SUB §11 "Test seeds", ruling R-25, acceptance 11 preparation)
// ---------------------------------------------------------------------------------------------------------------------

/** States a test clinic can be seeded in (the transition RPCs own every other move). */
export type SeedSubscriptionStatus = "trialing" | "active" | "expired" | "incomplete";

export interface SeedSubscriptionOptions {
  /** Default `trialing` on the Standard price (R-25): full access, Standard keys + ai.scribe with 1,500 drafts. */
  status?: SeedSubscriptionStatus;
  /** Comp the clinic for a year (`comp_until`): full access whatever the status, with the Standard price (Pitfall 8). */
  comp?: boolean;
  /** Override `access_ends_at` (time travel for lock tests: a past instant locks a trialing/active clinic). */
  accessEndsAt?: Date;
}

export interface SeededSubscription {
  tenantId: string;
  status: SeedSubscriptionStatus;
  planPriceId: string | null;
  accessEndsAt: string | null;
  compUntil: string | null;
}

const DAY_MS = 86_400_000;
let standardPriceLookup: Promise<string> | null = null;

/**
 * The Standard plan's price that is active now, looked up by plan code (never a fixed id: 05-09a wave note). Cached
 * per process; a failed lookup is not cached.
 */
export function standardPlanPriceId(): Promise<string> {
  standardPriceLookup ??= (async () => {
    const admin = getAdminClient();
    const { data: plan, error } = await admin.from("plans").select("id").eq("code", "standard").single();
    if (error || !plan) throw new Error(`Standard plan lookup failed: ${error?.message ?? "no row"}`);
    const now = new Date().toISOString();
    const { data: price, error: priceError } = await admin
      .from("plan_prices")
      .select("id")
      .eq("plan_id", plan.id)
      .lte("active_from", now)
      .or(`active_until.is.null,active_until.gt.${now}`)
      .order("active_from", { ascending: false })
      .limit(1)
      .single();
    if (priceError || !price) throw new Error(`Standard price lookup failed: ${priceError?.message ?? "no row"}`);
    return price.id;
  })().catch((e: unknown) => {
    standardPriceLookup = null;
    throw e;
  });
  return standardPriceLookup;
}

/**
 * Shapes the clinic's `tenant_subscriptions` row (created `incomplete` by the tenants trigger, R-24) with the service
 * role, so the clinic has the access level a test expects once the RLS helpers read it (05-10a):
 *   trialing   (default) Standard price, trial from now for 14 days, access until trial end + 24 h (SUB §6.2 buffer)
 *   active     Standard price, a 30-day period from now, access until period end + 24 h
 *   expired    Standard price, a period that ended 30 days ago: locked
 *   incomplete no price, no dates: onboarding (with `comp`: the Standard price, so the comp carries the Standard keys)
 * Every lifecycle column is written, so re-seeding a clinic from one state to another leaves nothing behind.
 */
export async function seedTenantSubscription(
  tenantId: string,
  options: SeedSubscriptionOptions = {},
): Promise<SeededSubscription> {
  const status = options.status ?? "trialing";
  const comp = options.comp ?? false;
  const admin = getAdminClient();
  const price = status === "incomplete" && !comp ? null : await standardPlanPriceId();
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();
  const endsAt = (fallbackMs: number | null) =>
    options.accessEndsAt ? options.accessEndsAt.toISOString() : fallbackMs === null ? null : iso(fallbackMs);

  const row: Database["public"]["Tables"]["tenant_subscriptions"]["Update"] = {
    status,
    plan_price_id: price,
    trial_start: null,
    trial_end: null,
    current_period_start: null,
    current_period_end: null,
    access_ends_at: null,
    cancel_at_period_end: false,
    canceled_at: null,
    cancel_source: null,
    past_due_since: null,
    grace_until: null,
    halted_at: null,
    expired_at: null,
    comp_until: comp ? iso(now + 365 * DAY_MS) : null,
    trial_consumed: false,
    updated_at: iso(now),
  };
  if (status === "trialing") {
    const trialEnd = now + 14 * DAY_MS;
    Object.assign(row, {
      trial_start: iso(now),
      trial_end: iso(trialEnd),
      access_ends_at: endsAt(trialEnd + DAY_MS),
      trial_consumed: true,
    });
  } else if (status === "active") {
    const periodEnd = now + 30 * DAY_MS;
    Object.assign(row, {
      current_period_start: iso(now),
      current_period_end: iso(periodEnd),
      access_ends_at: endsAt(periodEnd + DAY_MS),
    });
  } else if (status === "expired") {
    Object.assign(row, {
      current_period_start: iso(now - 60 * DAY_MS),
      current_period_end: iso(now - 30 * DAY_MS),
      access_ends_at: endsAt(now - 30 * DAY_MS),
      expired_at: iso(now - 30 * DAY_MS),
    });
  } else {
    Object.assign(row, { access_ends_at: endsAt(null) });
  }

  const { data, error } = await admin
    .from("tenant_subscriptions")
    .update(row)
    .eq("tenant_id", tenantId)
    .select("tenant_id, plan_price_id, access_ends_at, comp_until");
  if (error) throw new Error(`Failed to seed the subscription of ${tenantId}: ${error.message}`);
  if (!data || data.length !== 1) {
    throw new Error(`Failed to seed the subscription of ${tenantId}: expected its one row (tenants trigger), got ${data?.length ?? 0}`);
  }
  return {
    tenantId,
    status,
    planPriceId: data[0].plan_price_id,
    accessEndsAt: data[0].access_ends_at,
    compUntil: data[0].comp_until,
  };
}

/**
 * The same `trialing` Standard row as `seedTenantSubscription`, as one SQL statement for specs that create clinics
 * through `psql` (e.g. `tests/jobs/helpers.ts`): trial from now for 14 days, access until trial end + 24 h.
 */
export function trialingSubscriptionSql(tenantId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(tenantId)) {
    throw new Error("trialingSubscriptionSql: refusing a non-uuid tenant id");
  }
  return (
    "update public.tenant_subscriptions set status = 'trialing', " +
    "plan_price_id = (select pp.id from public.plan_prices pp join public.plans p on p.id = pp.plan_id " +
    "where p.code = 'standard' and pp.active_from <= now() and (pp.active_until is null or now() < pp.active_until) " +
    "order by pp.active_from desc limit 1), " +
    "trial_start = now(), trial_end = now() + interval '14 days', access_ends_at = now() + interval '15 days', " +
    `trial_consumed = true, updated_at = now() where tenant_id = '${tenantId}'`
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Locked and onboarding clinics (V2-05 05-10b; SUB-02 UX fixtures, also used by V2-06 06-05/06-06 through the e2e run)
// ---------------------------------------------------------------------------------------------------------------------

/** The access levels a fixture clinic can be seeded at (a `full` clinic is `seedTenantWithOwner`). */
export type AccessFixtureLevel = "locked" | "onboarding";

export interface AccessFixtureUser {
  userId: string;
  email: string;
  role: UserRole;
}

export interface AccessFixtureClinic {
  tenantId: string;
  tenantName: string;
  level: AccessFixtureLevel;
  /** One user per requested role, in the order given; each signs in with {@link seededUserPassword}. */
  users: AccessFixtureUser[];
}

/**
 * A synthetic clinic whose access level is `locked` (subscription `expired`, access ended 30 days ago) or `onboarding`
 * (the `incomplete` row the tenants trigger creates, R-24), with one member per role. Users are created with the
 * admin API only (no sign-in here: e2e signs them in through the login UI once per run, Vitest through
 * {@link signInSeededUser}). The level is read back with `tenant_access_for_system` and checked, so a fixture that
 * drifted from the access function fails at seed time instead of passing a redirect test vacuously.
 */
export async function seedAccessFixtureClinic(
  level: AccessFixtureLevel,
  tenantName: string,
  roles: readonly UserRole[] = ["owner"],
): Promise<AccessFixtureClinic> {
  const admin = getAdminClient();
  const { data: tenant, error: tenantError } = await admin.from("tenants").insert({ name: tenantName }).select("id").single();
  if (tenantError || !tenant) throw new Error(`Failed to create the ${level} fixture clinic: ${tenantError?.message}`);

  const users: AccessFixtureUser[] = [];
  for (const role of roles) {
    const email = `access-${level}-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
    const { data: created, error: userError } = await admin.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (userError || !created.user) throw new Error(`Failed to create a ${level} fixture user: ${userError?.message}`);
    const { error: memError } = await admin.from("memberships").insert({ user_id: created.user.id, tenant_id: tenant.id, role });
    if (memError) throw new Error(`Failed to add a ${level} fixture member: ${memError.message}`);
    users.push({ userId: created.user.id, email, role });
  }

  if (level === "locked") await seedTenantSubscription(tenant.id, { status: "expired" });

  const { data: actual, error: levelError } = await admin.rpc("tenant_access_for_system", { p_tenant: tenant.id });
  if (levelError) throw new Error(`Failed to read the ${level} fixture clinic's access level: ${levelError.message}`);
  if (actual !== level) throw new Error(`The ${level} fixture clinic reads as '${String(actual)}'`);

  return { tenantId: tenant.id, tenantName, level, users };
}

/** A signed-in anon-key client (the browser's session) for a user seeded with {@link seededUserPassword}. */
export async function signInSeededUser(email: string): Promise<TestDb> {
  const client = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await signInWithRetry(client, email, TEST_PASSWORD);
  return client;
}
