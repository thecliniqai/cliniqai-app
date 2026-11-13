/**
 * V2-03 03-09b (roadmap V2-03 test "a scrubber test"; P1-25, T-03-03, T-03-14): `lib/observability/scrub.ts`.
 *
 * A corpus of synthetic identifiers (Indian mobiles in every common form, Aadhaar, ABHA, PAN, emails, Postgres row
 * details, long digit runs, UUIDs, tokens and query strings) is scrubbed: no identifier survives, benign diagnostic
 * text is kept, the result is one line of at most 500 characters. The independent export checker
 * (`scripts/ops/check-error-export.mjs`) flags every raw item and passes every scrubbed one. All values are synthetic.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_FRAMES,
  MAX_MESSAGE,
  routePattern,
  scrubFrames,
  scrubMessage,
} from "@/lib/observability/scrub";
import { checkErrorExport } from "@/scripts/ops/check-error-export.mjs";
import { buildErrorEvent } from "@/lib/observability/error-event";
import VECTORS from "../fixtures/scrub-vectors.json";

/** An unsigned synthetic JWT, assembled at runtime so secret scanners do not read the source line as a credential. */
const SYNTHETIC_JWT_PAYLOAD = Buffer.from(JSON.stringify({ sub: "synthetic" })).toString("base64url");
const SYNTHETIC_JWT = [Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url"), SYNTHETIC_JWT_PAYLOAD, "c2ln"].join(".");

/** [label, raw text, the synthetic identifier that must not survive]. */
const CORPUS: Array<[string, string, string]> = [
  ["+91 mobile", "send failed for +919000000001", "9000000001"],
  ["+91 spaced mobile", "send failed for +91 90000 00002", "90000 00002"],
  ["+91 dashed mobile", "send failed for +91-90000-00003", "90000-00003"],
  ["0-prefixed mobile", "callback 09000000004 unreachable", "9000000004"],
  ["0-prefixed spaced mobile", "callback 090000 00005 unreachable", "00005"],
  ["bare 10-digit mobile", "phone 9000000006 rejected", "9000000006"],
  ["3-3-4 mobile", "phone 900 000 0007 rejected", "0007"],
  ["Aadhaar with spaces", "aadhaar 2000 0000 0008 invalid", "2000 0000 0008"],
  ["Aadhaar unspaced", "aadhaar 200000000009 invalid", "200000000009"],
  ["ABHA", "abha 91-0000-0000-0010 not linked", "91-0000-0000-0010"],
  ["PAN", "pan ABCDE1234F mismatch", "ABCDE1234F"],
  ["email", "invite to synthetic.patient+tag@example.com bounced", "synthetic.patient"],
  ["Postgres Key detail", 'duplicate key value violates unique constraint "patients_phone_key" Key (tenant_id, phone)=(x, +919000000011) already exists.', "9000000011"],
  ["Postgres Key detail with a name", "Key (full_name)=(Synthetic Patientname) already exists.", "Synthetic Patientname"],
  ["Failing row", 'new row for relation "patients" violates check constraint "x" Failing row contains (Synthetic Rowname, 1990-01-01, f).', "Synthetic Rowname"],
  ["quoted input value", 'invalid input syntax for type uuid: "Synthetic Inputvalue"', "Synthetic Inputvalue"],
  ["long digit run", "account 123456789012345 locked", "123456789012345"],
  ["six-digit run", "otp 482913 expired", "482913"],
  ["UUID", "patient 3f2b8c4e-1a2b-4c3d-8e9f-0123456789ab not found", "3f2b8c4e-1a2b-4c3d-8e9f-0123456789ab"],
  ["JWT", `bad token ${SYNTHETIC_JWT}`, SYNTHETIC_JWT_PAYLOAD],
  ["bearer credential", "upstream said Bearer syntheticBearerValueXyz", "syntheticBearerValueXyz"],
  ["share token in a path", "fetch /r/k7Qp2xZ9mN4vB8sL1tR6 failed", "k7Qp2xZ9mN4vB8sL1tR6"],
  ["query string", "GET /api/reports/view?token=abcSynthetic&phone=9000000012 failed", "abcSynthetic"],
  ["query string phone", "GET /api/reports/view?token=abcSynthetic&phone=9000000012 failed", "9000000012"],
  ["JSON payload", 'payload {"phone":"Synthetic Jsonvalue"} rejected', "Synthetic Jsonvalue"],
];

describe("scrubMessage: no synthetic identifier survives", () => {
  it.each(CORPUS)("%s", (_label, raw, secret) => {
    const out = scrubMessage(raw);
    expect(out).not.toContain(secret);
    // The independent checker passes the scrubbed text.
    expect(checkErrorExport([row({ message: out })])).toEqual([]);
  });

  it.each(CORPUS)("the export checker flags the raw %s", (_label, raw) => {
    expect(checkErrorExport([row({ message: raw })]).some((p) => p.includes("message: matches"))).toBe(true);
  });

  it("an Error's message is scrubbed the same way as a string", () => {
    expect(scrubMessage(new Error("for +919000000013"))).toBe(scrubMessage("for +919000000013"));
    expect(scrubMessage(new Error("for +919000000013"))).not.toContain("9000000013");
  });

  it("non-string, non-Error input yields an empty message", () => {
    expect(scrubMessage(undefined)).toBe("");
    expect(scrubMessage({ message: "+919000000014" })).toBe("");
    expect(scrubMessage(42)).toBe("");
  });
});

describe("scrubMessage: benign diagnostic text is kept", () => {
  it.each([
    'relation "public.patients" does not exist',
    "column patients.full_name does not exist",
    "TypeError: Cannot read properties of undefined (reading 'id')",
    "PGRST116 JSON object requested, multiple (or no) rows returned",
    "fetch failed with status 503",
    "ERR_INVALID_ARG_TYPE",
  ])("%s", (text) => {
    expect(scrubMessage(text)).toBe(text);
  });

  it("keeps the column names of a Postgres Key detail and the constraint name", () => {
    const out = scrubMessage('violates unique constraint "patients_phone_key" Key (phone)=(+919000000015) already exists.');
    expect(out).toContain('"patients_phone_key"');
    expect(out).toContain("Key (phone)=([REDACTED])");
  });
});

describe("scrubMessage: shape", () => {
  it(`is one line of at most ${MAX_MESSAGE} characters`, () => {
    const out = scrubMessage(`first line\nsecond line ${"word ".repeat(400)}`);
    expect(out).not.toContain("\n");
    expect(out.length).toBeLessThanOrEqual(MAX_MESSAGE);
    expect(out.startsWith("first line second line")).toBe(true);
  });

  it("scrubs before truncating (an identifier straddling the cut does not survive in part)", () => {
    const raw = `${"x".repeat(MAX_MESSAGE - 6)} +919000000016 tail`;
    const out = scrubMessage(raw);
    expect(out).not.toMatch(/\d{4,}/);
    expect(out.length).toBeLessThanOrEqual(MAX_MESSAGE);
  });

  it("bounds the work on hostile input", () => {
    const out = scrubMessage(`${"a@b.co ".repeat(100_000)}`);
    expect(out.length).toBeLessThanOrEqual(MAX_MESSAGE);
    expect(out).not.toContain("@");
  });
});

describe("scrubFrames", () => {
  const root = "/srv/clinicos";
  const stack = [
    "Error: Key (phone)=(+919000000017)",
    "    at handler (/srv/clinicos/.next/server/app/api/diag/error/route.js:1:2345)",
    "    at /srv/clinicos/.next/server/app/(dashboard)/patients/[id]/page.js:12:7",
    "    at async Promise.all (index 0)",
    "    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)",
    "    at Object.run (/Users/someone/elsewhere/node_modules/x/index.js:9:1)",
    "    at eval (eval at <anonymous> (file:///srv/clinicos/a.js:1:1), <anonymous>:1:1)",
  ].join("\n");

  it("keeps file:line relative to the repo, drops function names, columns and the message line", () => {
    expect(scrubFrames(stack, root)).toEqual([
      ".next/server/app/api/diag/error/route.js:1",
      ".next/server/app/(dashboard)/patients/[id]/page.js:12",
      "node:internal/process/task_queues:105",
      "x/index.js:9",
    ]);
  });

  it(`keeps at most ${MAX_FRAMES} frames`, () => {
    const long = Array.from({ length: 50 }, (_, i) => `    at f (/srv/clinicos/lib/a.ts:${i + 1}:1)`).join("\n");
    expect(scrubFrames(long, root)).toHaveLength(MAX_FRAMES);
  });

  it("returns [] for a missing stack", () => {
    expect(scrubFrames(undefined, root)).toEqual([]);
  });
});

describe("routePattern", () => {
  it("keeps a route pattern and drops any query or fragment", () => {
    expect(routePattern("/r/[token]")).toBe("/r/[token]");
    expect(routePattern("/(dashboard)/patients/[id]")).toBe("/(dashboard)/patients/[id]");
    expect(routePattern("/api/reports/view?token=abcSynthetic")).toBe("/api/reports/view");
    expect(routePattern("/x#phone=9000000018")).toBe("/x");
  });

  it("refuses anything that is not a plain pattern", () => {
    expect(routePattern("r/[token]")).toBeNull();
    expect(routePattern("/a b")).toBeNull();
    expect(routePattern("/a%40b")).toBeNull();
    expect(routePattern(undefined)).toBeNull();
    expect(routePattern(`/${"a".repeat(300)}`)).toBeNull();
  });
});

/** A well-formed export row with the given overrides. */
function row(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    fingerprint: "a".repeat(64),
    occurred_on: "2026-11-13",
    first_seen: "2026-11-13T10:00:00.123456+00:00",
    last_seen: "2026-11-13T10:00:00.123456+00:00",
    count: 1,
    environment: "test",
    release: null,
    route_path: "/api/diag/error",
    route_type: "route",
    method: "POST",
    error_name: "DiagnosticError",
    error_code: "DIAG_SYNTHETIC",
    digest: null,
    message: "",
    frames: [],
    request_id: null,
    tenant_id: null,
    user_id: null,
    ...overrides,
  };
}

describe("check-error-export (the E9 verification)", () => {
  it("refuses an extra column, a missing column and an empty export", () => {
    expect(checkErrorExport([row({ headers: "x" })])).toContain("row 0 headers: column not allowed");
    const missing = row({});
    delete missing.message;
    expect(checkErrorExport([missing])).toContain("row 0 message: column missing");
    expect(checkErrorExport([])).toEqual(["export: no rows (nothing proven)"]);
  });

  it("refuses a concrete path or a query string in route_path", () => {
    expect(checkErrorExport([row({ route_path: "/r/abc?token=x" })])).toContain("row 0 route_path: unexpected shape");
  });

  it("accepts the SQL editor's one-cell form of the runbook query", () => {
    expect(checkErrorExport([{ export: [row({ message: "ok" })] }])).toEqual([]);
  });
});

/**
 * 03-13d M-SCRUB: the shared vectors (`tests/fixtures/scrub-vectors.json`), which the DB second line runs too. Each
 * message vector failed on the 03-09b scrubber (spaced/dashed/dotted mobiles, dashed Aadhaar, `@abdm`, IDN and
 * `localhost` emails, expression-index and multi-line row details, full-width digits, digit-free tokens, Supabase key
 * prefixes) or is the 03-09b corpus carried over.
 */
describe("shared scrub vectors (app layer)", () => {
  it.each(VECTORS.messages.map((v) => [v.id, v] as const))("message %s", (_id, vector) => {
    const out = scrubMessage(vector.input);
    for (const value of vector.absent) expect(out).not.toContain(value);
    for (const value of vector.kept) expect(out).toContain(value);
    expect(out).not.toContain("\n");
    expect(out.length).toBeLessThanOrEqual(MAX_MESSAGE);
  });

  it.each(VECTORS.benign)("benign text is kept unchanged: %s", (text) => {
    expect(scrubMessage(text)).toBe(text);
  });

  const meta = { environment: "test" as const, release: null, root: "/srv/clinicos" };
  it.each(VECTORS.fields.map((v) => [v.id, v] as const))("field %s", (_id, vector) => {
    const err = Object.assign(new Error("x"), { [vector.field === "error_name" ? "name" : "code"]: vector.input });
    const event = buildErrorEvent(err, undefined, undefined, meta);
    if (vector.field === "error_name") {
      expect(event.error_name).toBe(vector.stored ?? "Error");
    } else {
      expect(event.error_code).toBe(vector.stored);
    }
  });

  it.each(VECTORS.routes.accept)("route pattern kept: %s", (route) => {
    expect(routePattern(route)).toBe(route);
  });

  it.each(VECTORS.routes.reject)("concrete or malformed route refused: %s", (route) => {
    expect(routePattern(route)).toBeNull();
  });
});
