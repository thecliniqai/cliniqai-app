"use client";

import { createClient } from "@/lib/supabase/client";

// A client module under features/auth is NOT exempt: only server files there may sign out.
export async function leave() {
  await createClient().auth.signOut({ scope: "global" });
}
