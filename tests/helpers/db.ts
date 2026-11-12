import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * RL-13b test-only type seam (V2-02 plan 02-04).
 *
 * The hand-written `Database` type in `lib/db/types.ts` (interface row types, no `Enums`/`CompositeTypes`) makes
 * supabase-js resolve many tables and RPCs to `never` for a `SupabaseClient<Database>`, which produced ~300
 * false type errors in `tests/`. Test clients (the service-role admin client and the seeded users' clients) are
 * therefore typed through this one loose-schema alias. Runtime behaviour and every assertion are unchanged.
 *
 * Owner: V2-03 plan 03-03 (generated `Database` types) switches this back to `SupabaseClient<Database>` and
 * deletes the alias. Do not add other loose-schema casts in tests; use this seam.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- RL-13b loose schema until generated types (03-03)
export type TestDb = SupabaseClient<any, "public", any>;
