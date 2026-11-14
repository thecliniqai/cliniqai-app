/**
 * supabase/tests/database/migration_edge_cases_visit_integrity.test.sql (V2-05 05-11a) replays 000068's NOT VALID
 * constraints and 000069's clamp, renumbering and VALIDATE statements on planted legacy rows. pg_prove mounts only the
 * test directory, so the statements are inlined (research A7, as 05-02a's backfill and 05-03's FK edge cases): this
 * pins each one byte-identical to the migration, so the pgTAP case proves the statements that actually shipped.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const EXPAND = "supabase/migrations/000068_visit_integrity_expand.sql";
const MIGRATE = "supabase/migrations/000069_visit_integrity_migrate.sql";

const STATEMENTS: Array<[name: string, file: string, re: RegExp]> = [
  ["add duration check", EXPAND, /ALTER TABLE public\.visits\n {4}ADD CONSTRAINT visits_duration_range [^;]*;/g],
  ["add token check", EXPAND, /ALTER TABLE public\.queue_tokens\n {4}ADD CONSTRAINT queue_tokens_token_range [^;]*;/g],
  ["add signer FK", EXPAND, /ALTER TABLE public\.visits\n {4}ADD CONSTRAINT visits_tenant_signed_by_fkey [^;]*;/g],
  ["shrink", MIGRATE, /UPDATE public\.visits\n {3}SET estimated_duration_minutes = 480\n[^;]*;/g],
  ["grow and mark", MIGRATE, /UPDATE public\.visits x\n[\s\S]*?WHERE x\.estimated_duration_minutes < 5;/g],
  ["renumber tokens", MIGRATE, /WITH bad AS \([\s\S]*?WHERE q\.id = r\.id;/g],
  ["reset counters", MIGRATE, /UPDATE public\.queue_token_counters c\n[\s\S]*?WHERE c\.last_token > 9999;/g],
  ["validate duration", MIGRATE, /ALTER TABLE public\.visits VALIDATE CONSTRAINT visits_duration_range;/g],
  ["validate token", MIGRATE, /ALTER TABLE public\.queue_tokens VALIDATE CONSTRAINT queue_tokens_token_range;/g],
  ["validate signer", MIGRATE, /ALTER TABLE public\.visits VALIDATE CONSTRAINT visits_tenant_signed_by_fkey;/g],
];

function all(sql: string, re: RegExp): string[] {
  return [...sql.matchAll(re)].map((m) => m[0]);
}

describe("05-11a edge-case pgTAP inlines 000068/000069's statements verbatim", () => {
  const test = read("supabase/tests/database/migration_edge_cases_visit_integrity.test.sql");

  for (const [name, file, re] of STATEMENTS) {
    it(`the replayed ${name} statement is the migration's`, () => {
      const fromMigration = all(read(file), re);
      expect(fromMigration).toHaveLength(1);
      const fromTest = all(test, re);
      expect(fromTest).toHaveLength(1);
      expect(fromTest[0]).toBe(fromMigration[0]);
    });
  }

  it("the migration runs every data step it is replayed for, before its VALIDATE statements", () => {
    const sql = read(MIGRATE);
    const order = STATEMENTS.filter(([, file]) => file === MIGRATE).map(([, , re]) => sql.search(new RegExp(re.source)));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
