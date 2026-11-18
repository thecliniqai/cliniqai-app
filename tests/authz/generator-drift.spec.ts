/**
 * The committed generated files equal the generator's output (V2-05 05-01b, R-17, T-05-17).
 *
 * `npm run authz:gen` writes supabase/tests/database/authz_matrix.test.sql, authz_completeness.test.sql and
 * AUTHZ-MATRIX.md from tests/authz/table-matrix.ts. A hand edit of any of them, or a matrix change committed without
 * regenerating, fails here (evidence/05a/05-01b/generator-drift-edited.txt).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateAll, REPO_ROOT } from "../../scripts/gen-authz-pgtap";

describe("generated authorisation files", () => {
  const generated = generateAll();

  it.each(Object.keys(generated))("%s is exactly the generator's output", (rel) => {
    const file = path.join(REPO_ROOT, rel);
    expect(fs.existsSync(file), `${rel} is missing: run npm run authz:gen`).toBe(true);
    expect(fs.readFileSync(file, "utf8") === generated[rel], `${rel} differs: run npm run authz:gen`).toBe(true);
  });

  it("is deterministic (two runs, same bytes)", () => {
    expect(generateAll()).toEqual(generated);
  });
});
