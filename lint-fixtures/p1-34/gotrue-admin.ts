import { GoTrueAdminApi } from "@supabase/supabase-js";
import { GoTrueClient } from "@supabase/auth-js";

export const admin = (url: string, key: string) => new GoTrueAdminApi({ url, headers: { apikey: key } });
export const client = GoTrueClient;
