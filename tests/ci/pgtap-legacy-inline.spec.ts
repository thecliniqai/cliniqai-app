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
const readMigration = (name: string) => fs.readFileSync(path.join(ROOT, "supabase/migrations", name), "utf8");

function verbatimBlock(file: string): { migration: string; section: string; block: string } {
  const text = fs.readFileSync(path.join(ROOT, file), "utf8");
  const m = /^-- >>> verbatim (\d{6}_[a-z_]+\.sql) (§\d) \(lines \d+-\d+\)\n([\s\S]*?)^-- <<< verbatim$/m.exec(text);
  if (!m) throw new Error(`${file}: no verbatim block`);
  return { migration: m[1], section: m[2], block: m[3] };
}

describe("pgTAP legacy conversions inline their migration's block verbatim", () => {
  // V2-09c 000117: the search function moved to 000117 (the 000021 function was dropped), so its pg_trgm file inlines that migration's DO block.
  it.each([
    ["supabase/tests/database/memberships_bounds_cleanup.test.sql", "000021_review_fixes.sql", "§4", "-- 4. Scheduling bounds on memberships", 50],
    ["supabase/tests/database/search_medicines_extension_schema.test.sql", "000117_rx_lines_command.sql", "§2", "DO $migration$", 40],
  ])("%s carries %s %s unchanged", (file, migration, section, heading, minLines) => {
    const v = verbatimBlock(file);
    expect(v.migration).toBe(migration);
    expect(v.section).toBe(section);
    expect(v.block.startsWith(heading)).toBe(true);
    expect(v.block.split("\n").length).toBeGreaterThan(minLines);
    expect(readMigration(migration).includes(v.block)).toBe(true);
  });

  it("no legacy psql script is left at the top of supabase/tests other than the restore-drill checks", () => {
    const top = fs.readdirSync(path.join(ROOT, "supabase/tests")).filter((f) => f.endsWith(".sql"));
    expect(top).toEqual(["restore_drill_checks.sql"]);
  });
});
