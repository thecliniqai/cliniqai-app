// P0-13 canary fixture (V2-02 02-02). DELIBERATELY UNGUARDED route handler: answers 200 with patient rows read
// through the request client, without checking the session. Never routed by the app (not under app/). Used by
// tests/security/guard-canary.spec.ts.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data } = await supabase.from("patients").select("id, full_name");
  return NextResponse.json({ patients: data ?? [] }, { status: 200 });
}
