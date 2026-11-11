/**
 * V2-01a plan 01a-03: run-scoped teardown. Checks the parts of tests/setup/teardown.ts that a green run cannot
 * prove on its own. Everything created here is itself run data and is removed by the global teardown.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { acquireRunLock, findLeakedReferences, localAdminClient, NO_ACTION_USER_REFS } from "./teardown";

const ROOT = path.resolve(__dirname, "../..");

function localDbContainer(): string {
  const toml = fs.readFileSync(path.join(ROOT, "supabase/config.toml"), "utf8");
  const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(toml)?.[1];
  if (!projectId) throw new Error("project_id not found in supabase/config.toml");
  return `supabase_db_${projectId}`;
}

describe("teardown FK coverage", () => {
  it("lists exactly the public columns that reference auth.users with NO ACTION (live catalog)", () => {
    const sql =
      "select c.conrelid::regclass::text || '.' || a.attname from pg_constraint c " +
      "join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1] " +
      "where c.contype = 'f' and c.confrelid = 'auth.users'::regclass and c.confdeltype = 'a' " +
      "and c.connamespace = 'public'::regnamespace order by 1";
    const out = execFileSync("docker", ["exec", localDbContainer(), "psql", "-U", "postgres", "-Atc", sql], {
      encoding: "utf8",
    });
    const live = out.trim().split("\n").filter(Boolean).sort();
    const listed = NO_ACTION_USER_REFS.map(([t, c]) => `${t}.${c}`).sort();
    expect(listed).toEqual(live);
  });
});

describe("teardown leak check", () => {
  it("flags a run user's row in a tenant outside the run, and only that", async () => {
    const admin = localAdminClient();
    const { data: created, error: userErr } = await admin.auth.admin.createUser({
      email: `teardown-leak-${randomUUID()}@example.test`,
      password: `T-${randomUUID()}!9a`,
      email_confirm: true,
    });
    expect(userErr).toBeNull();
    const userId = created.user!.id;

    const { data: tenants, error: tErr } = await admin
      .from("tenants")
      .insert([{ name: "Teardown Inside Clinic" }, { name: "Teardown Outside Clinic" }])
      .select("id");
    expect(tErr).toBeNull();
    const [inside, outside] = tenants!.map((t) => t.id as string);

    const start = new Date(Date.now() + 86_400_000);
    const { error: bErr } = await admin.from("schedule_blocks").insert({
      tenant_id: outside,
      start_time: start.toISOString(),
      end_time: new Date(start.getTime() + 3_600_000).toISOString(),
      created_by: userId,
      reason: "teardown leak probe",
    });
    expect(bErr).toBeNull();

    expect(await findLeakedReferences(admin, [userId], [inside])).toEqual(["schedule_blocks.created_by: 1 row(s)"]);
    expect(await findLeakedReferences(admin, [userId], [inside, outside])).toEqual([]);
  });
});

describe("one run per local stack", () => {
  it("refuses a second concurrent run while this run holds the lock", () => {
    expect(() => acquireRunLock()).toThrow(/Another test run \(pid \d+\) is using the local stack/);
  });
});
