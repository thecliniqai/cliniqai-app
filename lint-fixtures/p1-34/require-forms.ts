import { createRequire } from "node:module";
const load = require;
export const aliased = load("@/lib/supabase/system");
export const viaModule = module.require("@/lib/supabase/system");
const spec = ["@/lib/supabase", "system"].join("/");
export const computed = require(spec);
export const built = createRequire(import.meta.url)("@/lib/supabase/system");
