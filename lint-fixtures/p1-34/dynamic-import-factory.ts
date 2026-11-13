export async function systemDbLater() {
  const { getSystemDb } = await import("@/lib/supabase/system");
  return getSystemDb("api_v1");
}
