/**
 * supabase/tests/database/clinical_notes_backfill.test.sql (V2-05 05-02a) replays 000053's backfill, clear and CHECK
 * statements on planted pre-migration visits. pg_prove mounts only the test directory, so the statements are inlined
 * (research A7, as 05-03's FK edge cases): this pins each one byte-identical to the migration, so the pgTAP case proves
 * the statements that actually shipped.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const STATEMENTS: Record<string, RegExp> = {
  backfill: /INSERT INTO public\.clinical_notes\n[\s\S]*?ON CONFLICT \(visit_id\) DO NOTHING;/g,
  clear: /UPDATE public\.visits\n[\s\S]*?OR advice IS NOT NULL;/g,
  check: /ALTER TABLE public\.visits ADD CONSTRAINT visits_clinical_content_moved CHECK \([\s\S]*?\n\);/g,
};

function all(sql: string, re: RegExp): string[] {
  return [...sql.matchAll(re)].map((m) => m[0]);
}

describe("05-02a backfill pgTAP inlines 000053's statements verbatim", () => {
  const migration = read("supabase/migrations/000053_clinical_notes_expand.sql");
  const test = read("supabase/tests/database/clinical_notes_backfill.test.sql");

  for (const [name, re] of Object.entries(STATEMENTS)) {
    it(`the replayed ${name} statement is the migration's`, () => {
      const fromMigration = all(migration, re);
      expect(fromMigration).toHaveLength(1);
      const fromTest = all(test, re);
      expect(fromTest.length).toBeGreaterThan(0);
      for (const stmt of fromTest) expect(stmt).toBe(fromMigration[0]);
    });
  }
});
