// Lint-gate fixture (AUTH-01): must FAIL lint. Never imported or executed.
import type { SupabaseClient } from "@supabase/supabase-js";

export async function fixture(supabase: SupabaseClient) {
  return supabase.auth.signInWithOtp({ email: "fixture@example.com", options: { shouldCreateUser: true } });
}
