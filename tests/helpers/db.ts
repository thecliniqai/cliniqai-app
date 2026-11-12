import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, Tables, TablesInsert } from "@/types/database";

/**
 * Typed test clients (RL-13b closed by V2-03 plan 03-03).
 *
 * Test clients (the service-role admin client and the seeded users' clients) are `SupabaseClient<Database>` over
 * the generated `types/database.ts`, so a renamed column or table fails `npm run typecheck`.
 */
export type TestDb = SupabaseClient<Database>;

type PublicTables = Database["public"]["Tables"];
export type PublicTable = keyof PublicTables;

/** Public tables whose primary key is a uuid `id` column. */
export type IdTable = {
  [K in PublicTable]: PublicTables[K]["Row"] extends { id: string } ? K : never;
}[PublicTable];

type Result<D> = PromiseLike<{ data: D | null; error: { message: string } | null }>;

/**
 * The slice of the query builder the helpers below use. supabase-js resolves `from()` only for a literal table
 * name; with a type parameter it widens rows to the union of all tables. Each helper's caller-facing signature
 * carries the per-table check instead, and reads the builder through this view.
 */
interface GenericTableBuilder<Row> {
  insert(row: object): { select(columns: "id"): { single(): Result<{ id: string }> } };
  select(columns: "*"): {
    eq(column: string, value: string): { single(): Result<Row> };
    in(column: string, values: readonly string[]): { limit(count: number): Result<Row[]> };
  };
}

function tableOf<T extends PublicTable>(db: TestDb, table: T): GenericTableBuilder<Tables<T>> {
  return db.from(table) as unknown as GenericTableBuilder<Tables<T>>;
}

/**
 * Insert one seed row through `db` and return its `id`. The row is checked against the generated insert type of
 * `table`, so a seed that names a missing column or omits a required one fails to compile.
 */
export async function insertReturningId<T extends IdTable>(db: TestDb, table: T, row: TablesInsert<T>): Promise<string> {
  const { data, error } = await tableOf(db, table).insert(row).select("id").single();
  if (error || !data) throw new Error(`seed ${table} failed: ${error?.message}`);
  return data.id;
}

/** Read one row of `table` by `id`, typed as the table's generated row. */
export async function rowById<T extends IdTable>(db: TestDb, table: T, id: string): Promise<Tables<T>> {
  const { data, error } = await tableOf(db, table).select("*").eq("id", id).single();
  if (error || !data) throw new Error(`read ${table} failed: ${error?.message}`);
  return data;
}

/** Every row of `table` whose `column` is one of `values` (at most 10,000), typed as the table's generated row. */
export async function rowsWhereIn<T extends PublicTable>(
  db: TestDb,
  table: T,
  column: keyof Tables<T> & string,
  values: readonly string[],
): Promise<Tables<T>[]> {
  if (values.length === 0) return [];
  const { data, error } = await tableOf(db, table).select("*").in(column, values).limit(10_000);
  if (error) throw new Error(`read ${table}: ${error.message}`);
  return data ?? [];
}

/**
 * A jsonb value (audit `metadata`, notification `metadata`, ...) read as an object, so a field read type-checks as
 * `Json | undefined`. Anything other than a plain object reads as `{}`, which fails the caller's field assertion.
 */
export function jsonObject(value: Json | undefined): { [key: string]: Json | undefined } {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}
