// @ts-nocheck: the subpaths resolve at run time (no `exports` map) but have no type declarations at these paths.
import { createServerClient } from "@supabase/ssr/dist/main/index.js";
import { createClient } from "@supabase/supabase-js/dist/module/index.js";

export const viaSsr = createServerClient;
export const viaJs = createClient;
