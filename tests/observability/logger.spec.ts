/**
 * V2-03 03-09a (P1-25, ruling R-6, T-03-03): the server logger writes one JSON line per call from a closed field set.
 * A caller that bypasses the type (`any`) still cannot get a free-form message, an unknown key or a non-UUID id into
 * the line. Synthetic values only.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { errorTag, log } from "@/lib/log";
import { reportClientError } from "@/lib/log/client";
import { INVALID_EVENT, MAX_COUNT, sanitiseFields, type LogWord } from "@/lib/log/fields";

const TENANT = "11111111-2222-4333-8444-555555555555";
const USER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const REQUEST = "0f0e0d0c-0b0a-4908-8706-050403020100";

let stdout: MockInstance;
let stderr: MockInstance;
let consoleSpies: MockInstance[];

function lines(spy: MockInstance): string[] {
  return spy.mock.calls.map((call) => String(call[0]));
}

function onlyLine(spy: MockInstance): Record<string, unknown> {
  const written = lines(spy);
  expect(written).toHaveLength(1);
  expect(written[0].endsWith("\n")).toBe(true);
  expect(written[0].slice(0, -1)).not.toContain("\n");
  return JSON.parse(written[0]) as Record<string, unknown>;
}

beforeEach(() => {
  stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => undefined)
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("log: closed field set", () => {
  it("drops a free-form message and unknown keys (row values, an email) from an any-typed call", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loose: any = {
      event: "patients.create_failed",
      message: "Key (phone)=(+919000000001) already exists",
      email: "synthetic.user@example.test",
      details: { phone: "+919000000001" },
      tenantId: TENANT,
    };
    log.error(loose);

    const raw = lines(stderr).join("");
    for (const leaked of ["message", "Key (phone)", "+919000000001", "email", "synthetic.user@example.test", "details"]) {
      expect(raw).not.toContain(leaked);
    }
    expect(onlyLine(stderr)).toEqual({
      ts: expect.any(String),
      level: "error",
      event: "patients.create_failed",
      tenantId: TENANT,
    });
  });

  it("drops ids that are not UUIDs", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    log.warn({ event: "auth.lookup_failed", tenantId: "+919000000001", userId: "user@example.test", requestId: "spoofed" } as any);
    const line = onlyLine(stderr);
    expect(line).not.toHaveProperty("tenantId");
    expect(line).not.toHaveProperty("userId");
    expect(line).not.toHaveProperty("requestId");
  });

  it("rejects an invalid event: the value is not written, the line says so", () => {
    for (const bad of ["Patient Ravi registered", "nodot", "Upper.case", "auth.", "a.b c", 42, undefined]) {
      stdout.mockClear();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      log.info({ event: bad } as any);
      const line = onlyLine(stdout);
      expect(line.event).toBe(INVALID_EVENT);
      if (typeof bad === "string") expect(lines(stdout).join("")).not.toContain(bad);
    }
  });

  it("keeps every known field when valid, in a single line, ts and level first", () => {
    log.info({
      event: "billing.payment_recorded",
      requestId: REQUEST,
      tenantId: TENANT,
      userId: USER,
      route: "/api/v1/patients/[id]",
      action: "record_payment",
      module: "billing",
      reason: "duplicate",
      code: errorTag(Object.assign(new Error("Key (phone)=(+919000000001)"), { code: "23505" })),
      status: 201,
      durationMs: 12.5,
      count: 3,
    });
    const written = lines(stdout)[0];
    expect(Object.keys(JSON.parse(written)).slice(0, 3)).toEqual(["ts", "level", "event"]);
    expect(onlyLine(stdout)).toEqual({
      ts: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      level: "info",
      event: "billing.payment_recorded",
      requestId: REQUEST,
      tenantId: TENANT,
      userId: USER,
      route: "/api/v1/patients/[id]",
      action: "record_payment",
      module: "billing",
      reason: "duplicate",
      code: "23505",
      status: 201,
      durationMs: 12.5,
      count: 3,
    });
    expect(stderr).not.toHaveBeenCalled();
  });

  it("drops an over-long word, a malformed code and non-finite or non-numeric numbers", () => {
    log.error({
      event: "jobs.run_failed",
      reason: "x".repeat(500) as LogWord,
      code: "Key (phone)=(+919000000001)",
      status: Number.NaN,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      count: "3" as any,
      durationMs: Number.POSITIVE_INFINITY,
    });
    const line = onlyLine(stderr);
    expect(line).not.toHaveProperty("reason");
    expect(line).not.toHaveProperty("code");
    expect(line).not.toHaveProperty("status");
    expect(line).not.toHaveProperty("count");
    expect(line).not.toHaveProperty("durationMs");
  });

  it("errorTag puts only an error's code or class name into a line, never its message", () => {
    expect(errorTag(Object.assign(new Error("Key (phone)=(+919000000001)"), { code: "23505" }))).toBe("23505");
    expect(errorTag(new TypeError("patient Ravi not found"))).toBe("TypeError");
    expect(errorTag("Key (phone)=(+919000000001)")).toBe("unknown");
  });

  it("writes exactly one line per call: info to stdout, warn and error to stderr, nothing through console", () => {
    log.info({ event: "app.started" });
    log.warn({ event: "app.slow_request", durationMs: 2001 });
    log.error({ event: "app.failed" });
    expect(lines(stdout).map((l) => JSON.parse(l).event)).toEqual(["app.started"]);
    expect(lines(stderr).map((l) => JSON.parse(l).level)).toEqual(["warn", "error"]);
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  });

  it("never throws, even for a non-object argument", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => log.error(null as any)).not.toThrow();
    expect(onlyLine(stderr).event).toBe(INVALID_EVENT);
  });
});

describe("reportClientError (R-29)", () => {
  it("development: one console.warn with the event and the error tag, never the message", () => {
    vi.stubEnv("NODE_ENV", "development");
    reportClientError("queue.refresh_failed", new TypeError("patient Ravi +919000000001"));
    const warn = consoleSpies[2];
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]).toEqual(["[queue.refresh_failed]", "TypeError"]);
  });

  it("production build: a no-op", () => {
    vi.stubEnv("NODE_ENV", "production");
    reportClientError("queue.refresh_failed", new Error("x"));
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  });
});

/**
 * 03-13d M-LOGFIELDS (review C M-1): `reason`, `action`, `module` and `route` used to be written verbatim (cut to 120
 * characters), and `status`/`count`/`durationMs` accepted any finite number. A caller that bypasses the types (a cast,
 * `any`) with row data, an email or a phone now gets the field dropped, never written.
 */
describe("closed field values (03-13d)", () => {
  const PHI = [
    "Key (phone)=(+919000000051) synthetic.patient@example.com",
    "Synthetic Patientname",
    "9000000052",
    "synthetic.patient@example.com",
    "visit_for_9000000053",
    "Recordpayment",
  ];

  it.each(PHI)("reason/action/module carrying %j are dropped", (value) => {
    const line = sanitiseFields({ event: "a.b", reason: value, action: value, module: value });
    expect(line).toEqual({ event: "a.b" });
  });

  it.each(["/r/abcDEF1234567890token", "/patients/9000000054", "/r/secrettoken123?phone=98", "Key (phone)=(x)", "patients"])(
    "a route %j that is not a plain pattern is dropped",
    (route) => {
      expect(sanitiseFields({ event: "a.b", route })).toEqual({ event: "a.b" });
    },
  );

  it("keeps machine words and route patterns", () => {
    expect(
      sanitiseFields({ event: "a.b", reason: "rate_limited", action: "auth.signout:others", module: "auth.email.ses", route: "/r/[token]" }),
    ).toEqual({ event: "a.b", route: "/r/[token]", action: "auth.signout:others", module: "auth.email.ses", reason: "rate_limited" });
  });

  it("status must be an HTTP status; count and durationMs bounded non-negative integers", () => {
    expect(sanitiseFields({ event: "a.b", status: 919000000055, count: 9000000056, durationMs: -1 })).toEqual({ event: "a.b" });
    expect(sanitiseFields({ event: "a.b", status: 99 })).toEqual({ event: "a.b" });
    expect(sanitiseFields({ event: "a.b", status: 404.5, count: 1.5 })).toEqual({ event: "a.b" });
    expect(sanitiseFields({ event: "a.b", status: 503, count: MAX_COUNT, durationMs: 0 })).toEqual({
      event: "a.b",
      status: 503,
      durationMs: 0,
      count: MAX_COUNT,
    });
  });

  it("a code carrying a phone-sized digit run is dropped", () => {
    expect(sanitiseFields({ event: "a.b", code: "x_9000000057" })).toEqual({ event: "a.b" });
  });

  it("the types refuse free text: an error message does not compile as reason, action, module or route", () => {
    const err = new Error("Key (phone)=(+919000000058)");
    // @ts-expect-error a plain string (an error message) is not a LogWord
    const reason: LogWord = err.message;
    // @ts-expect-error a plain string is not a route pattern
    const route: `/${string}` = err.message;
    expect([reason, route]).toHaveLength(2);
  });
});
