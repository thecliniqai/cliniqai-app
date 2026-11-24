/**
 * V2-07 07-00 (R-2, PWA-06a; migration 000095): `private.command_claim` / `private.command_complete` and the table
 * `private.command_results` behind every atomic command.
 *
 * The helpers have no public entry (they are called by the command functions of 07-01..07-03), so the specs call them
 * the way a command does: in one psql transaction as the `authenticated` role with the user's JWT claims and the
 * active-clinic header (or as `service_role` with a system actor). Real outcomes only: the stored rows, the replayed
 * result, the refusals, the lock wait of a concurrent duplicate, the rollback.
 * Synthetic data only.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { addMemberToTenant, seedTenantWithOwner, type SeededTenant } from "../helpers/tenants";
import { expectCommandCatalog } from "../helpers/command-catalog";
import { psql, psqlAsync, psqlSession } from "../helpers/sql";

let tenantA: SeededTenant;
let tenantB: SeededTenant;
let otherInA: SeededTenant;

/**
 * Since 000099 (07-04a F-4) the claim helpers have no API grant: only the definer commands call them. The specs call them
 * the way a command does, through session-local SECURITY DEFINER wrappers created as the superuser before the role
 * switch: the wrapper runs as the owner, while `auth.uid()`, the request headers and the `role` setting stay the
 * caller's (exactly what a definer command sees).
 */
const WRAPPERS = [
  "create function pg_temp.w_claim(uuid, uuid, text, text, text) returns jsonb language sql security definer as " +
    "$$ select private.command_claim($1, $2, $3, $4, $5) $$",
  "create function pg_temp.w_complete(uuid, uuid, jsonb) returns jsonb language sql security definer as " +
    "$$ select private.command_complete($1, $2, $3) $$",
  "grant execute on function pg_temp.w_claim(uuid, uuid, text, text, text), pg_temp.w_complete(uuid, uuid, jsonb) to authenticated, service_role",
];

/** Statements that open a transaction acting as `user` in `tenantId` (the app's JWT claims and active-clinic header). */
function asUser(user: SeededTenant, tenantId: string = user.tenantId): string[] {
  const claims = JSON.stringify({ sub: user.userId, role: "authenticated" });
  const headers = JSON.stringify({ "x-clinicos-tenant": tenantId });
  return [
    "begin",
    ...WRAPPERS,
    "set local role authenticated",
    `select set_config('request.jwt.claims', '${claims}', true)`,
    `select set_config('request.headers', '${headers}', true)`,
  ];
}

const asSystem = (): string[] => ["begin", ...WRAPPERS, "set local role service_role"];

function claim(tenantId: string, id: string | null, command: string, hash: string, systemActor: string | null = null): string {
  const q = (v: string | null) => (v === null ? "null" : `'${v}'`);
  return `select coalesce(pg_temp.w_claim('${tenantId}', ${q(id)}, '${command}', '${hash}', ${q(systemActor)})::text, 'NULL')`;
}

function complete(tenantId: string, id: string, result: object): string {
  return `select pg_temp.w_complete('${tenantId}', '${id}', '${JSON.stringify(result)}'::jsonb)::text`;
}

const rowsOf = (tenantId: string, id: string) =>
  psql(
    `select command || '|' || coalesce(actor_id::text, '-') || '|' || coalesce(system_actor, '-') || '|' || request_hash || '|' || coalesce(result::text, '-') ` +
      `from private.command_results where tenant_id = '${tenantId}' and client_request_id = '${id}'`
  );

/** The only result of the single statement that follows the 4 setup statements and `begin` output (set_config prints). */
function lastLine(lines: string[]): string {
  return lines[lines.length - 1];
}

beforeAll(async () => {
  tenantA = await seedTenantWithOwner("Synthetic Command Clinic A");
  tenantB = await seedTenantWithOwner("Synthetic Command Clinic B");
  otherInA = await addMemberToTenant(tenantA.tenantId, "receptionist");
});

describe("command_claim / command_complete", () => {
  it("a fresh claim answers NULL; complete stores the result and returns it; the row records command, actor and hash", () => {
    const id = randomUUID();
    const out = psqlSession([
      ...asUser(tenantA),
      claim(tenantA.tenantId, id, "billing.collect_payment", "hash-a"),
      complete(tenantA.tenantId, id, { invoice_id: "x", paid_total: 100 }),
      "commit",
    ]);
    expect(out.slice(-2)).toEqual(["NULL", '{"invoice_id": "x", "paid_total": 100}']);
    expect(rowsOf(tenantA.tenantId, id)).toEqual([
      `billing.collect_payment|${tenantA.userId}|-|hash-a|{"invoice_id": "x", "paid_total": 100}`,
    ]);
  });

  it("the same id, command, actor and request hash replays the stored result with replayed: true and writes nothing new", () => {
    const id = randomUUID();
    psqlSession([...asUser(tenantA), claim(tenantA.tenantId, id, "cmd.one", "h1"), complete(tenantA.tenantId, id, { n: 1 }), "commit"]);
    const replay = psqlSession([...asUser(tenantA), claim(tenantA.tenantId, id, "cmd.one", "h1"), "commit"]);
    expect(JSON.parse(lastLine(replay))).toEqual({ n: 1, replayed: true });
    // The stored result itself never carries the flag, and there is still exactly one row.
    expect(rowsOf(tenantA.tenantId, id)).toEqual([`cmd.one|${tenantA.userId}|-|h1|{"n": 1}`]);
    expect(psql(`select count(*) from private.command_results where client_request_id = '${id}'`)).toEqual(["1"]);
  });

  it("a replay is repeatable: every later submit with the same id gets the first result", () => {
    const id = randomUUID();
    psqlSession([...asUser(tenantA), claim(tenantA.tenantId, id, "cmd.one", "h1"), complete(tenantA.tenantId, id, { n: 7 }), "commit"]);
    for (let i = 0; i < 3; i++) {
      const out = psqlSession([...asUser(tenantA), claim(tenantA.tenantId, id, "cmd.one", "h1"), "commit"]);
      expect(JSON.parse(lastLine(out))).toEqual({ n: 7, replayed: true });
    }
  });

  it.each([
    ["a different request hash", "cmd.one", "h2"],
    ["a different command", "cmd.two", "h1"],
  ])("IDEMPOTENCY_MISMATCH: the same id with %s", (_name, command, hash) => {
    const id = randomUUID();
    psqlSession([...asUser(tenantA), claim(tenantA.tenantId, id, "cmd.one", "h1"), complete(tenantA.tenantId, id, { n: 1 }), "commit"]);
    expect(() => psqlSession([...asUser(tenantA), claim(tenantA.tenantId, id, command, hash), "rollback"])).toThrow(/IDEMPOTENCY_MISMATCH/);
    expect(rowsOf(tenantA.tenantId, id)).toEqual([`cmd.one|${tenantA.userId}|-|h1|{"n": 1}`]);
  });

  it("IDEMPOTENCY_MISMATCH: another user of the same clinic cannot replay (or read) someone else's command", () => {
    const id = randomUUID();
    psqlSession([...asUser(tenantA), claim(tenantA.tenantId, id, "cmd.one", "h1"), complete(tenantA.tenantId, id, { secret: "paid" }), "commit"]);
    let message = "";
    try {
      psqlSession([...asUser(otherInA), claim(tenantA.tenantId, id, "cmd.one", "h1"), "rollback"]);
    } catch (err) {
      message = String(err);
    }
    expect(message).toMatch(/IDEMPOTENCY_MISMATCH/);
    expect(message).not.toContain("paid");
  });

  it("the system path: a closed system actor claims and replays its own id; a user or another actor cannot reuse it", () => {
    const id = randomUUID();
    const actor = "system:payment_webhook";
    const first = psqlSession([...asSystem(), claim(tenantA.tenantId, id, "billing.record_payment", "hs", actor), complete(tenantA.tenantId, id, { ok: true }), "commit"]);
    expect(first.slice(-2)).toEqual(["NULL", '{"ok": true}']);
    expect(rowsOf(tenantA.tenantId, id)).toEqual([`billing.record_payment|-|${actor}|hs|{"ok": true}`]);

    const replay = psqlSession([...asSystem(), claim(tenantA.tenantId, id, "billing.record_payment", "hs", actor), "commit"]);
    expect(JSON.parse(lastLine(replay))).toEqual({ ok: true, replayed: true });

    expect(() => psqlSession([...asSystem(), claim(tenantA.tenantId, id, "billing.record_payment", "hs", "system:other"), "rollback"])).toThrow(/IDEMPOTENCY_MISMATCH/);
    expect(() => psqlSession([...asUser(tenantA), claim(tenantA.tenantId, id, "billing.record_payment", "hs"), "rollback"])).toThrow(/IDEMPOTENCY_MISMATCH/);
  });

  it("the actor rule: a user session with a system actor, and a system call without one, are ACTOR_INVALID", () => {
    expect(() => psqlSession([...asUser(tenantA), claim(tenantA.tenantId, randomUUID(), "cmd.one", "h1", "system:payment_webhook"), "rollback"])).toThrow(/ACTOR_INVALID/);
    expect(() => psqlSession([...asSystem(), claim(tenantA.tenantId, randomUUID(), "cmd.one", "h1"), "rollback"])).toThrow(/ACTOR_INVALID/);
  });

  it("CLIENT_REQUEST_ID_REQUIRED: a command without an id is refused and claims nothing", () => {
    const before = psql("select count(*) from private.command_results")[0];
    expect(() => psqlSession([...asUser(tenantA), claim(tenantA.tenantId, null, "cmd.one", "h1"), "rollback"])).toThrow(/CLIENT_REQUEST_ID_REQUIRED/);
    expect(psql("select count(*) from private.command_results")[0]).toBe(before);
  });

  it("a rolled-back command leaves no claim: the same id then runs fresh", () => {
    const id = randomUUID();
    const out = psqlSession([...asUser(tenantA), claim(tenantA.tenantId, id, "cmd.one", "h1"), complete(tenantA.tenantId, id, { n: 1 }), "rollback"]);
    expect(out.slice(-2)).toEqual(["NULL", '{"n": 1}']);
    expect(rowsOf(tenantA.tenantId, id)).toEqual([]);
    const retry = psqlSession([...asUser(tenantA), claim(tenantA.tenantId, id, "cmd.one", "h9"), "rollback"]);
    expect(lastLine(retry)).toBe("NULL");
  });

  it("a failed command (an error after the claim) rolls the claim back with everything else", () => {
    const id = randomUUID();
    expect(() =>
      psqlSession([...asUser(tenantA), claim(tenantA.tenantId, id, "cmd.one", "h1"), "select 1/0", "commit"])
    ).toThrow(/division by zero/);
    expect(rowsOf(tenantA.tenantId, id)).toEqual([]);
  });

  it("a claim that was never completed is not replayable (IDEMPOTENCY_MISMATCH, never an empty result)", () => {
    const id = randomUUID();
    expect(() =>
      psqlSession([...asUser(tenantA), claim(tenantA.tenantId, id, "cmd.one", "h1"), claim(tenantA.tenantId, id, "cmd.one", "h1"), "rollback"])
    ).toThrow(/IDEMPOTENCY_MISMATCH/);
  });

  it("COMMAND_NOT_CLAIMED: complete never writes a claim this transaction did not make, nor a second result", () => {
    const id = randomUUID();
    expect(() => psqlSession([...asUser(tenantA), complete(tenantA.tenantId, id, { n: 1 }), "rollback"])).toThrow(/COMMAND_NOT_CLAIMED/);
    psqlSession([...asUser(tenantA), claim(tenantA.tenantId, id, "cmd.one", "h1"), complete(tenantA.tenantId, id, { n: 1 }), "commit"]);
    expect(() => psqlSession([...asUser(tenantA), complete(tenantA.tenantId, id, { n: 2 }), "rollback"])).toThrow(/COMMAND_NOT_CLAIMED/);
    expect(rowsOf(tenantA.tenantId, id)).toEqual([`cmd.one|${tenantA.userId}|-|h1|{"n": 1}`]);
  });

  it("a user claims only in the active clinic: another clinic's id is NOT_FOUND and writes nothing, in either clinic", () => {
    const id = randomUUID();
    // The user of A names clinic B as the tenant (the header says A: the active clinic is A).
    expect(() => psqlSession([...asUser(tenantA), claim(tenantB.tenantId, id, "cmd.one", "h1"), "rollback"])).toThrow(/NOT_FOUND/);
    // The user of A naming B in the header is not a member of B: the active clinic stays A, so B is refused too.
    expect(() => psqlSession([...asUser(tenantA, tenantB.tenantId), claim(tenantB.tenantId, id, "cmd.one", "h1"), "rollback"])).toThrow(/NOT_FOUND/);
    expect(psql(`select count(*) from private.command_results where client_request_id = '${id}'`)).toEqual(["0"]);
  });

  it("the key is per clinic: two clinics may use the same client_request_id and never see each other's result", () => {
    const id = randomUUID();
    psqlSession([...asUser(tenantA), claim(tenantA.tenantId, id, "cmd.one", "h1"), complete(tenantA.tenantId, id, { clinic: "A" }), "commit"]);
    const b = psqlSession([...asUser(tenantB), claim(tenantB.tenantId, id, "cmd.one", "h1"), complete(tenantB.tenantId, id, { clinic: "B" }), "commit"]);
    expect(b.slice(-2)).toEqual(["NULL", '{"clinic": "B"}']);
    expect(rowsOf(tenantA.tenantId, id)).toEqual([`cmd.one|${tenantA.userId}|-|h1|{"clinic": "A"}`]);
    expect(rowsOf(tenantB.tenantId, id)).toEqual([`cmd.one|${tenantB.userId}|-|h1|{"clinic": "B"}`]);
  });
});

describe("concurrent duplicate claims", () => {
  const sessionA = "cmd_dup_a";
  const sessionB = "cmd_dup_b";

  /** Waits until the first session holds its claim, and returns once `pg_stat_activity` shows it. */
  async function waitForApp(app: string): Promise<void> {
    for (let i = 0; i < 200; i++) {
      if (psql(`select count(*) from pg_stat_activity where application_name = '${app}'`)[0] === "1") return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`session ${app} never showed up`);
  }

  /**
   * Session 1 claims and (optionally) completes, then holds its transaction open until session 2 is visibly blocked on
   * the primary key (a Lock wait), then ends with `ending`. Session 2 starts only after session 1 holds the claim.
   * Deterministic: no sleeps decide the outcome; a missing wait fails the DO block.
   */
  async function duplicate(ending: "commit" | "rollback", id: string, hash2: string) {
    // pg_stat_activity is a per-transaction snapshot: it is cleared each round or the loop never sees the other session.
    const blockedWait =
      `do $$ declare i int := 0; begin loop ` +
      `perform pg_stat_clear_snapshot(); ` +
      `exit when exists (select 1 from pg_stat_activity where application_name = '${sessionB}' and wait_event_type = 'Lock'); ` +
      `i := i + 1; if i > 200 then raise exception 'the duplicate never waited'; end if; perform pg_sleep(0.025); end loop; end $$`;
    const first = psqlAsync(
      [
        ...asUser(tenantA),
        `set local application_name = '${sessionA}'`,
        claim(tenantA.tenantId, id, "cmd.one", "h1"),
        ...(ending === "commit" ? [complete(tenantA.tenantId, id, { n: 1 })] : []),
        "reset role",
        blockedWait,
        ending,
      ].join("; ") + ";"
    );
    await waitForApp(sessionA);
    const second = psqlAsync(
      [...asUser(tenantA), `set local application_name = '${sessionB}'`, claim(tenantA.tenantId, id, "cmd.one", hash2), "commit"].join("; ") + ";"
    );
    // psqlAsync (-c, not -q) also prints the command tags; keep the statements' own output.
    const output = (lines: string[]) => lines.filter((l) => !/^(BEGIN|SET|DO|COMMIT|ROLLBACK|CREATE FUNCTION|GRANT)$/.test(l));
    // Settle both together: the second can reject (IDEMPOTENCY_MISMATCH) before the first resolves, and awaiting them
    // one after the other left that rejection unhandled for a moment (CI run 44304509920, "Unhandled Rejection").
    const [a, b] = await Promise.allSettled([first, second]);
    if (a.status === "rejected") throw a.reason;
    if (b.status === "rejected") throw b.reason;
    return { first: output(a.value), second: output(b.value) };
  }

  it("the second session waits on the first, then replays its committed result once", async () => {
    const id = randomUUID();
    const { first, second } = await duplicate("commit", id, "h1");
    expect(first).toContain("NULL");
    expect(JSON.parse(second[second.length - 1])).toEqual({ n: 1, replayed: true });
    expect(rowsOf(tenantA.tenantId, id)).toEqual([`cmd.one|${tenantA.userId}|-|h1|{"n": 1}`]);
  });

  it("if the first session rolls back, the waiting duplicate claims fresh (nothing stale)", async () => {
    const id = randomUUID();
    const { second } = await duplicate("rollback", id, "h1");
    expect(second[second.length - 1]).toBe("NULL");
    // The second session committed its own claim (never completed here): exactly one row, the second's.
    expect(psql(`select count(*) from private.command_results where client_request_id = '${id}'`)).toEqual(["1"]);
  });

  it("a duplicate with a different request hash waits, then is refused (IDEMPOTENCY_MISMATCH)", async () => {
    const id = randomUUID();
    await expect(duplicate("commit", id, "h-different")).rejects.toThrow(/IDEMPOTENCY_MISMATCH/);
    expect(rowsOf(tenantA.tenantId, id)).toEqual([`cmd.one|${tenantA.userId}|-|h1|{"n": 1}`]);
  });
});

describe("surface and catalog", () => {
  it("command_results has no API entry: members cannot read it, and the helpers are not served by PostgREST", async () => {
    expect(() => psqlSession([...asUser(tenantA), "select count(*) from private.command_results", "rollback"])).toThrow(/permission denied for table command_results/);
    for (const fn of ["command_claim", "command_complete"]) {
      const { error } = await tenantA.client.rpc(fn as never, {} as never);
      expect(error?.code).toBe("PGRST202");
    }
    const [flags] = psql(
      "select relrowsecurity || '|' || (select count(*) from pg_policies where schemaname = 'private' and tablename = 'command_results') " +
        "from pg_class where oid = 'private.command_results'::regclass"
    );
    expect(flags).toBe("true|0");
    expect(psql("select has_table_privilege('service_role', 'private.command_results', 'SELECT')")).toEqual(["f"]);
  });

  it("catalog (the shared assertion): the claim helpers are definer, pinned, and executable by no API role (F-4)", () => {
    expectCommandCatalog({ signature: "private.command_claim(uuid, uuid, text, text, text)", definer: true, noApiGrant: true, command: false });
    expectCommandCatalog({ signature: "private.command_complete(uuid, uuid, jsonb)", definer: true, noApiGrant: true, command: false });
  });

  it("F-4: a signed-in user or the service role calling a claim helper directly is refused (no EXECUTE, 42501)", () => {
    const id = randomUUID();
    const direct = (role: string) => [
      "begin",
      `set local role ${role}`,
      `select private.command_claim('${tenantA.tenantId}', '${id}', 'cmd.one', 'h1', null)`,
      "rollback",
    ];
    expect(() => psqlSession(direct("authenticated"))).toThrow(/permission denied for function command_claim/);
    expect(() => psqlSession(direct("service_role"))).toThrow(/permission denied for function command_claim/);
    expect(() => psqlSession(["begin", "set local role authenticated", `select private.command_complete('${tenantA.tenantId}', '${id}', '{}'::jsonb)`, "rollback"])).toThrow(
      /permission denied for function command_complete/
    );
  });

  it("F-4: a system claim needs the service role's `role` setting, not just a missing session (a postgres session with a system actor is ACTOR_INVALID)", () => {
    expect(() =>
      psqlSession(["begin", ...WRAPPERS, claim(tenantA.tenantId, randomUUID(), "cmd.one", "h1", "system:payment_webhook"), "rollback"])
    ).toThrow(/ACTOR_INVALID/);
  });

  it("the shared catalog assertion is not vacuous: it fails for a wrong definer flag and for a function with no client_request_id", () => {
    const recordPayment = "public.record_payment(uuid, uuid, numeric, text, text, uuid, text, text, bigint)";
    expectCommandCatalog({ signature: recordPayment, definer: true, serviceRole: true, command: false });
    expect(() => expectCommandCatalog({ signature: recordPayment, definer: false, serviceRole: true, command: false })).toThrow();
    expect(() => expectCommandCatalog({ signature: recordPayment, definer: true, serviceRole: false, command: false })).toThrow();
    // record_payment predates PWA-06a (its idempotency key is p_command_id): the command form refuses it.
    expect(() => expectCommandCatalog({ signature: recordPayment, definer: true, serviceRole: true })).toThrow();
  });

  it("every clinic has its default location, including the ones this helper seeds (R-5)", () => {
    for (const t of [tenantA, tenantB]) {
      expect(psql(`select name || '|' || is_default from public.clinic_locations where tenant_id = '${t.tenantId}'`)).toEqual(["Main|true"]);
    }
  });
});
