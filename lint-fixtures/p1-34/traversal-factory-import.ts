import { getSystemDb } from "../../lib/supabase/system";

export const systemDb = () => getSystemDb("api_v1");
