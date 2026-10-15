import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Database, UserRole } from "@/lib/db/types";
import { env } from "@/lib/env";
import { getAdminClient } from "./supabase-admin";

export interface SeededTenant {
  tenantId: string;
  tenantName: string;
  userId: string;
  userEmail: string;
  role: UserRole;
  client: SupabaseClient<Database>;
}

async function signInWithRetry(client: SupabaseClient<Database>, email: string, password: string) {
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
 */
export async function seedTenantWithOwner(tenantName: string): Promise<SeededTenant> {
  const admin = getAdminClient();
  const email = `test-doctor-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;

  // 1. Create user via admin auth
  const password = "TestPassword123!";
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

  // 4. Create authenticated anon client with user session
  const userClient = createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
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
  client: SupabaseClient<Database>;
}> {
  const admin = getAdminClient();
  const email = `unlinked-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;

  const password = "TestPassword123!";
  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (userError || !userData.user) {
    throw new Error(`Failed to create test user: ${userError?.message}`);
  }

  const userClient = createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
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

  const password = "TestPassword123!";
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

  const userClient = createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
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
  client: SupabaseClient<Database>;
}

export interface DualTenantEcosystem {
  tenantA: {
    tenantId: string;
    tenantName: string;
    owner: SeededTenant;
    doctor: SeededTenant;
    patientId: string;
    consentId: string;
    auditLogId: string;
    invitationId: string;
    invitationToken: string;
    subscriptionId: string;
    paymentRecordId: string;
  };
  tenantB: {
    tenantId: string;
    tenantName: string;
    owner: SeededTenant;
    doctor: SeededTenant;
    patientId: string;
    consentId: string;
    auditLogId: string;
    invitationId: string;
    invitationToken: string;
    subscriptionId: string;
    paymentRecordId: string;
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

  const password = "TestPassword123!";
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

  const userClient = createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
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
 * (patients, consent_records, audit_logs, invitations, subscriptions, payment_records),
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
  const { data: patientA, error: pAError } = await (admin.from("patients") as any)
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

  const { data: patientB, error: pBError } = await (admin.from("patients") as any)
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
  const { data: consentA, error: cAError } = await (admin.from("consent_records") as any)
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

  const { data: consentB, error: cBError } = await (admin.from("consent_records") as any)
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
  const { data: auditA, error: audAError } = await (admin.from("audit_logs") as any)
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

  const { data: auditB, error: audBError } = await (admin.from("audit_logs") as any)
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

  const { data: invA, error: invAError } = await (admin.from("invitations") as any)
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

  const { data: invB, error: invBError } = await (admin.from("invitations") as any)
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

  // 8. Seed Subscriptions
  const { data: subA, error: subAError } = await (admin.from("subscriptions") as any)
    .insert({
      tenant_id: ownerA.tenantId,
      plan: "standard",
      amount_inr: 1000,
      status: "active",
      current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
    })
    .select("id")
    .single();
  if (subAError || !subA) throw new Error(`Failed to seed subscription A: ${subAError?.message}`);

  const { data: subB, error: subBError } = await (admin.from("subscriptions") as any)
    .insert({
      tenant_id: ownerB.tenantId,
      plan: "standard",
      amount_inr: 1000,
      status: "trialing",
      current_period_end: new Date(Date.now() + 14 * 86400000).toISOString(),
    })
    .select("id")
    .single();
  if (subBError || !subB) throw new Error(`Failed to seed subscription B: ${subBError?.message}`);

  // 9. Seed Payment Records
  const { data: payA, error: payAError } = await (admin.from("payment_records") as any)
    .insert({
      tenant_id: ownerA.tenantId,
      amount_inr: 1000,
      method: "upi",
      reference: `pay_a_${suffix}`,
    })
    .select("id")
    .single();
  if (payAError || !payA) throw new Error(`Failed to seed payment record A: ${payAError?.message}`);

  const { data: payB, error: payBError } = await (admin.from("payment_records") as any)
    .insert({
      tenant_id: ownerB.tenantId,
      amount_inr: 1000,
      method: "upi",
      reference: `pay_b_${suffix}`,
    })
    .select("id")
    .single();
  if (payBError || !payB) throw new Error(`Failed to seed payment record B: ${payBError?.message}`);


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
      subscriptionId: subA.id,
      paymentRecordId: payA.id,
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
      subscriptionId: subB.id,
      paymentRecordId: payB.id,
    },
    dualUser,
  };
}


