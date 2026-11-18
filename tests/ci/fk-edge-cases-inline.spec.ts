/**
 * supabase/tests/database/migration_edge_cases_fk.test.sql (V2-05 05-03) replays 000048's backfill on a planted item
 * that predates prescription_items.tenant_id. pg_prove mounts only the test directory, so the statement is inlined
 * (research A7, as 05-01a's legacy files): this pins it byte-identical to the migration, so the pgTAP case proves
 * the statement that actually shipped.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

function backfill(sql: string): string {
  const m = /UPDATE public\.prescription_items i\n[\s\S]*?AND i\.tenant_id IS NULL/.exec(sql);
  if (!m) throw new Error("backfill statement not found");
  return m[0];
}

describe("05-03 edge-case pgTAP inlines 000048's backfill verbatim", () => {
  it("the replayed UPDATE is the migration's statement", () => {
    const migration = backfill(read("supabase/migrations/000048_prescription_items_tenant_id.sql"));
    const test = backfill(read("supabase/tests/database/migration_edge_cases_fk.test.sql"));
    expect(test).toBe(migration);
  });
});
