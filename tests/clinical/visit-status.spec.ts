/**
 * The one visit-status map (V2-06 06-03a; 06-PLAN "Tests that fail without the change": every status string used in
 * the code has exactly one entry; an unknown value gives a neutral chip, never a crash).
 *
 * The status strings are collected from the sources themselves, so a new status anywhere fails this spec until the map
 * learns it:
 * - the database: the `visits.status` CHECK constraint in supabase/migrations (the generated `types/database.ts` types
 *   the column as plain `string`, so the constraint is the schema's own list);
 * - the hand-written domain type `VisitStatus` in lib/db/types.ts;
 * - the v1 status constants (`VISIT_STATUSES`, `QUEUE_OPEN_STATUSES`, `PATIENT_ACTIONABLE_STATUSES`, the queue's
 *   `statusOrder` keys) and every `visit.status` / `v.status` / `appointment.status` comparison with a string literal
 *   in app/**, features/** and components/**.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DERIVED_VISIT_STATUSES,
  STORED_VISIT_STATUSES,
  UNKNOWN_VISIT_STATUS,
  VISIT_STATUS_ENTRIES,
  compareVisitStatus,
  displayVisitStatus,
  formatWait,
  isVisitStatusKey,
  spokenWait,
  visitStatus,
  waitLevel,
} from "@/lib/visit-status";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

/** The status list of every CHECK constraint on `visits.status` across the migrations, in file order. */
function databaseStatuses(): { file: string; values: string[] }[] {
  const dir = "supabase/migrations";
  const found: { file: string; values: string[] }[] = [];
  for (const file of fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = read(path.join(dir, file));
    const create = /CREATE TABLE IF NOT EXISTS public\.visits \(([\s\S]*?)\n\);/i.exec(sql);
    const blocks = [create?.[1] ?? ""];
    for (const m of sql.matchAll(/ALTER TABLE[^;]*\bvisits\b[^;]*ADD CONSTRAINT[^;]*CHECK\s*\(\s*status\s+IN\s*\(([^)]*)\)/gi)) {
      blocks.push(`status TEXT CHECK (status IN (${m[1]}))`);
    }
    for (const block of blocks) {
      const check = /status\s+TEXT[^,]*CHECK\s*\(\s*status\s+IN\s*\(([^)]*)\)/i.exec(block);
      if (check) found.push({ file, values: [...check[1].matchAll(/'([a-z_]+)'/g)].map((v) => v[1]) });
    }
  }
  return found;
}

/** The members of `export type VisitStatus = | "a" | "b" …;` in lib/db/types.ts. */
function domainTypeStatuses(): string[] {
  const src = read("lib/db/types.ts");
  const m = /export type VisitStatus =([^;]*);/.exec(src);
  if (!m) throw new Error("VisitStatus not found in lib/db/types.ts");
  return [...m[1].matchAll(/"([a-z_]+)"/g)].map((v) => v[1]);
}

/** Status strings the v1 code compares visits against or lists as constants: `[file, value]`. */
function codeStatuses(): [string, string][] {
  const out: [string, string][] = [];
  const files = [...walk("app"), ...walk("features"), ...walk("components")];
  for (const file of files) {
    const src = read(file);
    for (const m of src.matchAll(/\b(?:visit|v|i\.visit|appointment)\??\.status\s*[!=]==?\s*["']([a-z_-]+)["']/g)) {
      out.push([file, m[1]]);
    }
    for (const m of src.matchAll(/const (?:VISIT_STATUSES|QUEUE_OPEN_STATUSES|PATIENT_ACTIONABLE_STATUSES)\s*=\s*\[([^\]]*)\]/g)) {
      for (const v of m[1].matchAll(/["']([a-z_]+)["']/g)) out.push([file, v[1]]);
    }
    const order = /const statusOrder: Record<string, number> = \{([^}]*)\}/.exec(src);
    if (order) for (const v of order[1].matchAll(/([a-z_]+):\s*\d+/g)) out.push([file, v[1]]);
  }
  return out;
}

describe("lib/visit-status: one entry per status", () => {
  it("the stored list equals the database CHECK constraint on visits.status (latest definition)", () => {
    const checks = databaseStatuses();
    expect(checks.length).toBeGreaterThanOrEqual(1);
    const latest = checks[checks.length - 1];
    expect([...latest.values].sort()).toEqual([...STORED_VISIT_STATUSES].sort());
  });

  it("the stored list equals the VisitStatus domain type", () => {
    expect(domainTypeStatuses().sort()).toEqual([...STORED_VISIT_STATUSES].sort());
  });

  it("every status string the v1 code uses for a visit has an entry", () => {
    const used = codeStatuses();
    // The collector must find the known call sites (a broken regex would pass vacuously).
    expect(used.length).toBeGreaterThan(40);
    expect(new Set(used.map(([, v]) => v))).toEqual(new Set(STORED_VISIT_STATUSES));
    const missing = used.filter(([, v]) => !isVisitStatusKey(v) || !visitStatus(v).stored);
    expect(missing).toEqual([]);
  });

  it("keys, labels and orders are unique; stored and derived keys do not overlap", () => {
    const keys = VISIT_STATUS_ENTRIES.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.sort()).toEqual([...STORED_VISIT_STATUSES, ...DERIVED_VISIT_STATUSES].sort());
    const labels = VISIT_STATUS_ENTRIES.map((e) => e.label);
    expect(new Set(labels).size).toBe(labels.length);
    const orders = VISIT_STATUS_ENTRIES.map((e) => e.order);
    expect(new Set(orders).size).toBe(orders.length);
    for (const d of DERIVED_VISIT_STATUSES) expect(visitStatus(d).stored).toBe(false);
    for (const s of STORED_VISIT_STATUSES) expect(visitStatus(s).stored).toBe(true);
  });

  it("labels, tones and icons follow the approved table (06-UI-SPEC 'Visit status hues', CD-29)", () => {
    const table = Object.fromEntries(
      VISIT_STATUS_ENTRIES.map((e) => [e.key, [e.label, e.tone, e.icon?.displayName ?? null]]),
    );
    expect(table).toEqual({
      booked: ["Booked", "booked", "CalendarClock"],
      confirmed: ["Confirmed", "booked", "CalendarCheck"],
      waiting: ["Waiting", "waiting", "Hourglass"],
      in_consultation: ["With doctor", "with-doctor", "Stethoscope"],
      to_bill: ["To bill", "to-bill", "IndianRupee"],
      completed: ["Done", "done", "CircleCheck"],
      no_show: ["No-show", "no-show", "UserX"],
      cancelled: ["Cancelled", "cancelled", "CircleX"],
      rescheduled: ["Rescheduled", "info", "CalendarSync"],
    });
    // Every status has an icon besides its label (never colour alone); none uses the accent.
    for (const e of VISIT_STATUS_ENTRIES) {
      expect(e.icon).not.toBeNull();
      expect(e.tone).not.toMatch(/accent|primary/);
    }
  });

  it("unknown, empty and non-string values give the neutral entry, never a throw", () => {
    for (const v of ["", "rescheduling", "Waiting", "with_doctor", "canceled", "__proto__", "toString", null, undefined, 3, {}]) {
      expect(visitStatus(v)).toBe(UNKNOWN_VISIT_STATUS);
    }
    expect(UNKNOWN_VISIT_STATUS).toMatchObject({ label: "Unknown status", tone: "unknown", icon: null });
  });

  it("a completed visit with money due is 'To bill'; paid, zero or unknown balance is 'Done'", () => {
    expect(displayVisitStatus("completed", 700).key).toBe("to_bill");
    expect(displayVisitStatus("completed", 0.01).key).toBe("to_bill");
    expect(displayVisitStatus("completed", 0).key).toBe("completed");
    expect(displayVisitStatus("completed", null).key).toBe("completed");
    expect(displayVisitStatus("completed", Number.NaN).key).toBe("completed");
    expect(displayVisitStatus("completed").key).toBe("completed");
    // Only a completed visit can be "To bill".
    expect(displayVisitStatus("waiting", 700).key).toBe("waiting");
    expect(displayVisitStatus("bogus", 700)).toBe(UNKNOWN_VISIT_STATUS);
  });

  it("sorts in lifecycle order with unknown values last", () => {
    const sorted = ["cancelled", "bogus", "completed", "waiting", "booked", "in_consultation", "no_show", "confirmed"].sort(
      compareVisitStatus,
    );
    expect(sorted).toEqual(["booked", "confirmed", "waiting", "in_consultation", "completed", "no_show", "cancelled", "bogus"]);
  });
});

describe("lib/visit-status: queue wait times", () => {
  it("levels at the boundaries: < 30 normal, 30–60 long, > 60 critical", () => {
    expect([0, 29, 30, 59, 60, 61, 240].map(waitLevel)).toEqual([
      "normal",
      "normal",
      "long",
      "long",
      "long",
      "critical",
      "critical",
    ]);
  });

  it("formats as DESIGN_SYSTEM §5: 6 min, 1 h 05 min, 2 h", () => {
    expect(formatWait(6)).toBe("6 min");
    expect(formatWait(59.9)).toBe("59 min");
    expect(formatWait(60)).toBe("1 h");
    expect(formatWait(65)).toBe("1 h 05 min");
    expect(formatWait(125)).toBe("2 h 05 min");
    expect(formatWait(-3)).toBe("0 min");
    expect(formatWait(Number.NaN)).toBe("0 min");
  });

  it("speaks the wait in words", () => {
    expect(spokenWait(1)).toBe("waiting 1 minute");
    expect(spokenWait(38)).toBe("waiting 38 minutes");
    expect(spokenWait(60)).toBe("waiting 1 hour");
    expect(spokenWait(125)).toBe("waiting 2 hours 5 minutes");
    expect(spokenWait(0)).toBe("waiting 0 minutes");
  });
});
