import { SupabaseClient } from "@supabase/supabase-js";

export const secondFactory = (url: string, key: string) => new SupabaseClient(url, key);
