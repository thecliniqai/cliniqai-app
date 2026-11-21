/**
 * V2-08 08-03b (M4 criterion 7): the front-desk screens send one command per user action. Files under `components/today`,
 * `components/front-desk` and `components/schedule` (08-04b) may not import the legacy multi-step writers, whose several
 * statements and app-side audit are what the V2-07 commands replaced.
 *
 * V2-09b 09B-01: `components/consultation` is covered too. The draft is saved by one command per save (`save_consultation_draft`, through the draft
 * saver), so no consult component imports the removed multi-statement writers (`recordFollowUp`, `updateClinicalNotes`). One chain is left on purpose and
 * named here: the v1 "Repeat Rx" loop in the workspace (one `addPrescriptionItem` per medicine of a past visit), owned by V2-09c ("Same as last visit"
 * as one command). A second importer of `addPrescriptionItem` outside the prescription builder fails this spec until it is named.
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

/** The multi-statement consult writers 000112 removed (the draft command replaced them). */
const CONSULT_LEGACY = ["recordFollowUp", "updateClinicalNotes", "saveConsultationDraft"];
/**
 * Files in `components/consultation` that may still import a writer, with what they may import and who removes it.
 * `saveConsultationDraft` is the command itself: only the draft hook calls it.
 */
const CONSULT_EXCEPTIONS: Record<string, { allowed: string[]; owner: string; why: string }> = {
  "components/consultation/use-consult-draft.ts": { allowed: ["saveConsultationDraft"], owner: "V2-09b", why: "the draft hook sends the one command per save" },
  "components/consultation/workspace/consult-workspace.tsx": { allowed: ["addPrescriptionItem"], owner: "V2-09c", why: "v1 Repeat Rx loop: one addPrescriptionItem per past medicine" },
  "components/consultation/prescription-builder.tsx": { allowed: ["addPrescriptionItem"], owner: "V2-09c", why: "the builder adds one item per tap (the keyboard builder replaces it)" },
};

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

  it("components/consultation sends one command per save: no removed writer, and addPrescriptionItem only where it is named (the Repeat Rx loop is V2-09c's)", () => {
    const watched = [...CONSULT_LEGACY, "addPrescriptionItem"];
    const offenders: string[] = [];
    const seen = new Set<string>();
    for (const file of files("components/consultation")) {
      const rel = path.relative(ROOT, file);
      for (const name of importedNames(fs.readFileSync(file, "utf8"))) {
        if (!watched.includes(name)) continue;
        seen.add(`${rel}#${name}`);
        if (!CONSULT_EXCEPTIONS[rel]?.allowed.includes(name)) offenders.push(`${rel} imports ${name}`);
      }
    }
    expect(offenders).toEqual([]);
    // The named exceptions are all still real (an entry that no longer matches is removed, not left to hide the next importer).
    const stale = Object.entries(CONSULT_EXCEPTIONS).flatMap(([rel, e]) => e.allowed.filter((n) => !seen.has(`${rel}#${n}`)).map((n) => `${rel}#${n}`));
    expect(stale).toEqual([]);
    expect(CONSULT_EXCEPTIONS["components/consultation/workspace/consult-workspace.tsx"]).toMatchObject({ owner: "V2-09c" });
  });

  it("the scan itself recognises an import of a legacy writer", () => {
    expect(importedNames('import { updateVisitStatus, type X } from "@/features/visits/actions";')).toContain("updateVisitStatus");
    expect(importedNames('import type { createPatient as make } from "@/x";')).toContain("createPatient");
    expect(importedNames('import { checkInVisit } from "@/features/queue/actions";')).not.toContain("updateVisitStatus");
  });
});
