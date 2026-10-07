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

/**
 * Seeds a tenant with an owner user using the admin client,
 * then generates a session and returns an authenticated anon client
 * simulating the user's browser session.
 */
export async function seedTenantWithOwner(tenantName: string): Promise<SeededTenant> {
  const admin = getAdminClient();
  const email = `test-doctor-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;

  // 1. Create user via admin auth
  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email,
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

  // 4. Generate user session token via admin link
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  if (linkError || !linkData.properties?.hashed_token) {
    throw new Error(`Failed to generate test auth link: ${linkError?.message}`);
  }

  // 5. Create authenticated anon client with user session
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

  const { error: verifyError } = await userClient.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "email",
  });

  if (verifyError) {
    throw new Error(`Failed to authenticate user client: ${verifyError.message}`);
  }

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

  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });

  if (userError || !userData.user) {
    throw new Error(`Failed to create test user: ${userError?.message}`);
  }

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  if (linkError || !linkData.properties?.hashed_token) {
    throw new Error(`Failed to generate test auth link: ${linkError?.message}`);
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

  await userClient.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "email",
  });

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

  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email,
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

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  if (linkError || !linkData.properties?.hashed_token) {
    throw new Error(`Failed to generate link: ${linkError?.message}`);
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

  await userClient.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "email",
  });

  return {
    tenantId,
    tenantName: "Existing Clinic",
    userId,
    userEmail: email,
    role,
    client: userClient,
  };
}

