import type { SupabaseClient, createClient } from "@supabase/supabase-js";
import type { createServerClient } from "@supabase/ssr";

export type Db = SupabaseClient;
export type Factory = typeof createClient | typeof createServerClient;
