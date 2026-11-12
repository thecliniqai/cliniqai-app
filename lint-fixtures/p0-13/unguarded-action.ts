"use server";
// P0-13 canary fixture (V2-02 02-02). DELIBERATELY UNGUARDED: reads patients through the request client with no
// session, permission or membership check and returns the rows. Never imported by the app. Used by
// tests/security/guard-canary.spec.ts (in place) and by the CI canary step (scripts/ci/guard-canary.mjs), which copies
// it to features/__guard_canary__/actions.ts and requires tests/security/guard-actions.spec.ts to FAIL.
import { createClient } from "@/lib/supabase/server";

export async function listCanaryPatients() {
  const supabase = await createClient();
  const { data } = await supabase.from("patients").select("id, full_name");
  return { success: true, patients: data ?? [] };
}
