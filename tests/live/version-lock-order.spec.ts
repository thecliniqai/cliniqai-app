/**
 * V2-09e 09E-14a (E): the cross-statement lock order of the clinic's version rows (queue, schedule, billing, settings: `VERSION_LOCK_ORDER`). Two transactions that
 * raise two domains in opposite orders can deadlock on the `clinic_versions` row locks, so no function may raise a later domain before an earlier one. This reads every
 * migration, finds each function body that calls `private.clinic_bump(..., '<domain>')` more than once, and requires its domains in the documented order. (A raise
 * that is not a literal domain is refused too: the order could not be read.)
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { VERSION_LOCK_ORDER } from "@/lib/live/domains";

const MIGRATIONS = path.resolve(__dirname, "../../supabase/migrations");

/** [function name, domains raised in source order] for every CREATE FUNCTION of a migration that calls clinic_bump. */
export function bumpSequences(sql: string): Array<[string, string[]]> {
  const out: Array<[string, string[]]> = [];
  const parts = sql.split(/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+/i).slice(1);
  for (const part of parts) {
    const name = /^([\w.]+)/.exec(part)?.[1] ?? "?";
    const body = part.slice(0, part.search(/\n\s*\$\w*\$\s*;|\$function\$\s*;/) > 0 ? part.search(/\n\s*\$\w*\$\s*;|\$function\$\s*;/) : undefined);
    if (name === "private.clinic_bump") continue;
    const calls = [...body.matchAll(/private\.clinic_bump\(([\s\S]*?)\)\s*;/g)].map((m) => /,\s*'([a-z_]+)'\s*$/.exec(m[1].trim())?.[1] ?? "?");
    if (calls.length > 0) out.push([name, calls]);
  }
  return out;
}

describe("version rows are raised in one order", () => {
  const files = fs.readdirSync(MIGRATIONS).filter((f) => /^0001(2[3-9]|[3-9]\d)/.test(f) || /^0002/.test(f));
  const all = files.flatMap((f) => bumpSequences(fs.readFileSync(path.join(MIGRATIONS, f), "utf8")).map(([fn, d]) => ({ file: f, fn, domains: d })));

  it("finds the statement triggers of 000123 and 000127", () => {
    expect(all.length).toBeGreaterThanOrEqual(10);
    expect(all.some((r) => r.fn === "private.cv_visits_insert" && r.domains.join() === "queue,schedule")).toBe(true);
    expect(all.some((r) => r.fn === "private.cv_patients_update")).toBe(true);
  });

  it("no function raises a domain after a later one, and every domain is a literal of the closed list", () => {
    const bad = all.filter((r) => {
      const idx = r.domains.map((d) => (VERSION_LOCK_ORDER as readonly string[]).indexOf(d));
      return idx.some((i) => i < 0) || idx.some((i, k) => k > 0 && i < idx[k - 1]);
    });
    expect(bad.map((r) => `${r.file} ${r.fn}: ${r.domains.join(",")}`)).toEqual([]);
  });

  it("the checker itself refuses an out-of-order function", () => {
    const sql = `CREATE FUNCTION private.x() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM private.clinic_bump(v, 'settings'); PERFORM private.clinic_bump(v, 'queue'); RETURN NULL; END; $$;`;
    const [[, domains]] = bumpSequences(sql);
    const idx = domains.map((d) => (VERSION_LOCK_ORDER as readonly string[]).indexOf(d));
    expect(idx.some((i, k) => k > 0 && i < idx[k - 1])).toBe(true);
  });
});
