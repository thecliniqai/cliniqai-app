// Lint-gate fixture (AUTH-01): must PASS the AUTH-01 gates (password sign-in and the recovery code are allowed).
import type { SupabaseClient } from "@supabase/supabase-js";

export async function fixture(supabase: SupabaseClient, email: string, password: string, token: string) {
  await supabase.auth.signInWithPassword({ email, password });
  return supabase.auth.verifyOtp({ email, token, type: "recovery" });
}
