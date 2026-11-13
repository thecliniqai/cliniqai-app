const specifier = ["@/lib/supabase", "system"].join("/");

export const load = () => import(specifier);
