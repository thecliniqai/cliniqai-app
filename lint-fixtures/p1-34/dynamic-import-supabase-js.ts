export async function clientLater(url: string, key: string) {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(url, key);
}
