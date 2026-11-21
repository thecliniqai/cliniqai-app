/**
 * V2-08 08-03b (M4 criterion 7): the front-desk screens send one command per user action. Files under `components/today`,
 * `components/front-desk` and `components/schedule` (08-04b) may not import the legacy multi-step writers, whose several
 * statements and app-side audit are what the V2-07 commands replaced.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const DIRS = ["components/today", "components/front-desk", "components/schedule"];
// V2-08 08-04a deleted `updateVisitStatus`, the multi-statement `cancelVisit` and `confirmAppointment`: the names now belong to the
// atomic commands in features/visits/scheduling.ts, which the Schedule screen may import.
const LEGACY = ["createPatient", "createVisit", "updateVisitStatus", "transitionQueueState"];

function files(dir: string): string[] {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full, { recursive: true, withFileTypes: true }).flatMap((entry) =>
    entry.isFile() && /\.(ts|tsx)$/.test(entry.name) ? [path.join(entry.parentPath, entry.name)] : []
  );
}

/** The names a file imports (`import { a, b as c } from ...`, type-only imports included). */
function importedNames(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["'][^"']+["']/g)) {
    for (const part of match[1]!.split(",")) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]!.trim();
      if (name) names.push(name);
    }
  }
  return names;
}

describe("no client command chains (M4 criterion 7)", () => {
  it("the front-desk components exist (the scan is not vacuous)", () => {
    expect(files("components/today").length).toBeGreaterThan(5);
    expect(files("components/front-desk").length).toBeGreaterThan(3);
  });

  it("none of them imports a legacy multi-step writer", () => {
    const offenders: string[] = [];
    for (const dir of DIRS) {
      for (const file of files(dir)) {
        const imported = importedNames(fs.readFileSync(file, "utf8"));
        for (const name of LEGACY) if (imported.includes(name)) offenders.push(`${path.relative(ROOT, file)} imports ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the scan itself recognises an import of a legacy writer", () => {
    expect(importedNames('import { updateVisitStatus, type X } from "@/features/visits/actions";')).toContain("updateVisitStatus");
    expect(importedNames('import type { createPatient as make } from "@/x";')).toContain("createPatient");
    expect(importedNames('import { checkInVisit } from "@/features/queue/actions";')).not.toContain("updateVisitStatus");
  });
});
