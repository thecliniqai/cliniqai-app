import { PostgrestClient } from "@supabase/postgrest-js";

export const rest = (url: string, key: string) => new PostgrestClient(url, { headers: { apikey: key } });
