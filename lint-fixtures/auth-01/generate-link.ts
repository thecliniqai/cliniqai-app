// Lint-gate fixture (AUTH-01): must FAIL lint. Never imported or executed.
import type { SupabaseClient } from "@supabase/supabase-js";

export async function fixture(admin: SupabaseClient) {
  return admin.auth.admin["generateLink"]({ type: "magiclink", email: "fixture@example.com" });
}
