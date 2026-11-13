const { getSystemDb } = require("@/lib/supabase/system");

export const systemDb = () => getSystemDb("api_v1");
