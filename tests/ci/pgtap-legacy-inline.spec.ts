/**
 * The two pgTAP files converted from the legacy psql scripts (V2-05 05-01a) re-run a section of migration 000021
 * inline, because pg_prove's container cannot `\ir` supabase/migrations (research A7). The inlined block must be the
 * migration's own text, byte for byte: a copy edited in the test (e.g. a weakened clamp) would let the test pass while
 * proving nothing about the migration. 000021 itself is immutable (scripts/ci/migration-immutability.mjs).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const MIGRATION = fs.readFileSync(path.join(ROOT, "supabase/migrations/000021_review_fixes.sql"), "utf8");

function verbatimBlock(file: string): { section: string; block: string } {
  const text = fs.readFileSync(path.join(ROOT, file), "utf8");
  const m = /^-- >>> verbatim 000021_review_fixes\.sql (§\d) \(lines \d+-\d+\)\n([\s\S]*?)^-- <<< verbatim$/m.exec(text);
  if (!m) throw new Error(`${file}: no verbatim block`);
  return { section: m[1], block: m[2] };
}

describe("pgTAP legacy conversions inline migration 000021 verbatim", () => {
  it.each([
    ["supabase/tests/database/memberships_bounds_cleanup.test.sql", "§4", "-- 4. Scheduling bounds on memberships"],
    ["supabase/tests/database/search_medicines_extension_schema.test.sql", "§6", "-- 6. search_medicines: pg_trgm in any schema"],
  ])("%s carries 000021 %s unchanged", (file, section, heading) => {
    const v = verbatimBlock(file);
    expect(v.section).toBe(section);
    expect(v.block.startsWith(heading)).toBe(true);
    expect(v.block.split("\n").length).toBeGreaterThan(50);
    expect(MIGRATION.includes(v.block)).toBe(true);
  });

  it("no legacy psql script is left at the top of supabase/tests other than the restore-drill checks", () => {
    const top = fs.readdirSync(path.join(ROOT, "supabase/tests")).filter((f) => f.endsWith(".sql"));
    expect(top).toEqual(["restore_drill_checks.sql"]);
  });
});
