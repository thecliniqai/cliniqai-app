// Lint-gate fixture (AUTH-01): must FAIL lint. Never imported or executed.
import type { SupabaseClient } from "@supabase/supabase-js";

export function fixture(supabase: SupabaseClient) {
  const { signInWithIdToken } = supabase.auth;
  return signInWithIdToken;
}
