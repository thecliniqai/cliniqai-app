"use server";
import { getSystemDb } from "@/lib/supabase/system";

export async function listEveryClinicsPatients() {
  return getSystemDb("api_v1").from("patients").select("id");
}
