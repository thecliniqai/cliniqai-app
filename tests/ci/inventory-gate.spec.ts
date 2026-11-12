/**
 * Inventory gate (F14, V2-02 02-01): the type-aware server-action inventory runs in CI (`static` job,
 * `npm run inventory`) and must fail the job on a flag. Proven by running the real CLI through the pinned local tsx
 * against fixture modules: an acting-principal override and an acting tenant hidden in a named parameter type exit 1;
 * a clean action exits 0.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT, runChecker } from "./run-checker";

const TSX = path.join(ROOT, "node_modules/.bin/tsx");
const inventory = (scanDir: string) => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "inventory-gate-")), "inventory.json");
  const r = runChecker(TSX, ["scripts/inventory-server-actions.ts", "--scan-dir", scanDir, "--out", out]);
  return { ...r, report: JSON.parse(fs.readFileSync(out, "utf8")) as { counts: { flagged: number } } };
};

describe("inventory gate (F14)", () => {
  it("exits 1 and names the module when a \"use server\" export takes an override or an acting tenant", () => {
    const r = inventory("lint-fixtures/inventory/flagged");
    expect(r.status).toBe(1);
    expect(r.report.counts.flagged).toBe(2);
    expect(r.stderr).toContain(
      "FLAG lint-fixtures/inventory/flagged/actions.ts saveNoteFixture param 0 type field tenantId",
    );
    expect(r.stderr).toContain("FLAG lint-fixtures/inventory/flagged/actions.ts saveNoteFixture param 1: clientOverride");
  }, 60_000);

  it("exits 1 on entry points it cannot inventory: inline \"use server\", route.{js,jsx,tsx,mjs}, a JS action module (02-06)", () => {
    const r = inventory("lint-fixtures/inventory/inline");
    expect(r.status).toBe(1);
    expect(r.report.counts.flagged).toBe(6);
    const dir = "lint-fixtures/inventory/inline";
    expect(r.stderr).toContain(`FLAG ${dir}/page.tsx (inline) function-level directive (line 6): use server`);
    for (const route of ["js-route/route.js", "jsx-route/route.jsx", "tsx-route/route.tsx", "mjs-route/route.mjs"]) {
      expect(r.stderr).toContain(`FLAG ${dir}/${route} (module) file name`);
    }
    expect(r.stderr).toContain(`FLAG ${dir}/js-module/actions.js (module) directive: use server`);
  }, 60_000);

  it("exits 0 on an action that takes only target ids", () => {
    const r = inventory("lint-fixtures/inventory/clean");
    expect(r.status).toBe(0);
    expect(r.report.counts.flagged).toBe(0);
    expect(r.stderr).toContain("0 flagged");
  }, 60_000);
});
