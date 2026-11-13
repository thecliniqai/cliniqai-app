/**
 * V2-03 03-13d H-LOG (review C H-1): `lib/observability/console-scrub.ts`. Next prints uncaught server errors with
 * `console.error(err)`; Node's inspector would write the message, the stack and every own property (PostgREST
 * `details`, a `cause`). With the scrubber installed, what reaches the underlying console carries none of the
 * synthetic values, while the error class, code and frames stay for debugging. All values are synthetic.
 */
import { formatWithOptions } from "node:util";
import { describe, expect, it } from "vitest";
import { CONSOLE_METHODS, installConsoleScrub } from "@/lib/observability/console-scrub";

const PHONE = "+919000000061";
const EMAIL = "synthetic.console@example.com";
const NAME_PATH = "tenants/x/patients/y/labs/Synthetic_Consolename_cbc.pdf";
const SECRETS = [PHONE, "9000000061", EMAIL, "Synthetic_Consolename", "9000000062", "9000000063"];

/** A console whose methods print through `util.format` into `out` (what Node's console would write). */
function fakeConsole() {
  const out: string[] = [];
  const target = Object.fromEntries(
    CONSOLE_METHODS.map((m) => [m, (...args: unknown[]) => void out.push(`${m}: ${formatWithOptions({ colors: false }, ...args)}`)]),
  ) as unknown as Console;
  return { target, out };
}

function postgrestError(): Error {
  // The shape supabase-js throws: message + details + hint + code as own properties.
  return Object.assign(new Error('duplicate key value violates unique constraint "patients_phone_key"'), {
    name: "PostgrestError",
    code: "23505",
    details: `Key (tenant_id, phone)=(x, ${PHONE}) already exists.`,
    hint: `contact ${EMAIL}`,
  });
}

describe("console scrubber", () => {
  it("without it, Node prints PostgREST details, a cause and a storage path verbatim (the leak H-1 describes)", () => {
    const { target, out } = fakeConsole();
    target.error(postgrestError());
    target.error(new Error(`upload failed: ${NAME_PATH}`, { cause: new Error(`for 9000000062 ${EMAIL}`) }));
    const printed = out.join("\n");
    for (const value of [PHONE, EMAIL, "Synthetic_Consolename", "9000000062"]) expect(printed).toContain(value);
  });

  it("an Error's message, details, hint, cause and stack text are scrubbed; name, code and frames stay", () => {
    const { target, out } = fakeConsole();
    expect(installConsoleScrub(target, process.cwd())).toBe(true);
    target.error(postgrestError());
    target.error("⨯", new Error(`upload failed: ${NAME_PATH}`, { cause: Object.assign(new Error(`for 9000000062 ${EMAIL}`), { code: "ECONNRESET" }) }));
    target.warn("unhandledRejection:", { message: `row ${PHONE}`, details: "Failing row contains (Synthetic Rowname, 9000000063)." });
    const printed = out.join("\n");
    for (const value of [...SECRETS, "Synthetic Rowname"]) expect(printed).not.toContain(value);
    expect(printed).toContain("PostgrestError [23505]");
    expect(printed).toContain("details: Key (tenant_id, phone)=([REDACTED])");
    expect(printed).toContain("[cause] Error [ECONNRESET]");
    expect(printed).toContain("at tests/observability/console-scrub.spec.ts:");
    expect(printed).toContain("Failing row contains ([REDACTED])");
  });

  it("strings and numbers are scrubbed on every wrapped method; objects are never inspected", () => {
    const { target, out } = fakeConsole();
    installConsoleScrub(target, process.cwd());
    for (const method of CONSOLE_METHODS) target[method](`${method} for ${PHONE} %s`, EMAIL);
    target.log(9000000061);
    target.info({ phone: PHONE, nested: { email: EMAIL } }, [PHONE]);
    const printed = out.join("\n");
    for (const value of SECRETS) expect(printed).not.toContain(value);
    expect(out).toHaveLength(CONSOLE_METHODS.length + 2);
    expect(printed).toContain("[Object] [Array(1)]");
  });

  it("is idempotent: a second install does not double-wrap", () => {
    const { target } = fakeConsole();
    expect(installConsoleScrub(target)).toBe(true);
    const first = target.error;
    expect(installConsoleScrub(target)).toBe(false);
    expect(target.error).toBe(first);
  });

  it("never throws on hostile arguments", () => {
    const { target, out } = fakeConsole();
    installConsoleScrub(target);
    const hostile = new Proxy({}, { get: () => { throw new Error(`trap ${PHONE}`); } });
    const circular: Record<string, unknown> = { message: `loop ${PHONE}`, code: "LOOP_CODE" };
    circular.cause = circular;
    expect(() => target.error(hostile, circular, Symbol("s"), () => 1, 10n)).not.toThrow();
    expect(out.join("\n")).not.toContain("9000000061");
  });
});
