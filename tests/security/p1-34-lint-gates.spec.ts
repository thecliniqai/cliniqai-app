/**
 * P1-34 boundary lint gates (V2-03 03-04; ADR-0005 D2/D4 + A1, C50 a/d/e; P1-21, P1-25, P1-15). Runs ESLint itself:
 * each fixture in lint-fixtures/p1-34/ is linted as text at a virtual repository path (README there) so the real
 * `files:` globs of eslint.config.mjs decide, then the exact rule, line and backlog prefix of every boundary message
 * is asserted. Last, the real app code is linted and must carry 0 boundary messages (the roadmap acceptance
 * "1 service-role factory, 0 service-role imports outside the allow-list and the register").
 *
 * 03-13c (M-LINT, M-ALLOWLIST; review B M-3/M-4, IND L-3): every lint here runs with inline configuration OFF, so an
 * `eslint-disable` or `/* eslint … *\/` comment cannot hide a gate from the spec or the census; with it ON (what
 * `npx eslint .` does) the `clinicos/no-boundary-directive` rule fails the directive itself. Fixtures cover every
 * Supabase value import (SupabaseClient, GoTrueAdminApi, @supabase/postgrest-js, @supabase/auth-js, package subpaths),
 * every require form, secret-key names built from pieces and computed env reads, the narrowed lib/jobs zone and imports
 * of the tooling trees.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import { p134Counters } from "../../scripts/ci/p1-34-counters.mjs";

const ROOT = path.resolve(__dirname, "../..");
const FIXTURES = path.join(ROOT, "lint-fixtures/p1-34");
const PREFIXES = ["P1-34:", "P1-21:", "P1-25:", "P1-15:"] as const;
type Prefix = (typeof PREFIXES)[number];
const IMPORTS = "@typescript-eslint/no-restricted-imports";
const SYNTAX = "no-restricted-syntax";

let eslint: ESLint;
beforeAll(() => {
  eslint = new ESLint({ cwd: ROOT, ignore: false, allowInlineConfig: false });
});

// no-restricted-syntax messages start with the backlog id; typescript-eslint's no-restricted-imports prepends its own
// sentence ("'x' import is restricted from being used by a pattern. P1-34: …"), so the id is matched after a space.
const BOUNDARY_ID = /(?:^|\s)(P1-(?:34|21|25|15):)/;
function boundaryId(message: string): Prefix | null {
  const match = BOUNDARY_ID.exec(message);
  return match && (PREFIXES as readonly string[]).includes(match[1]) ? (match[1] as Prefix) : null;
}

function boundaryMessages(messages: ESLint.LintResult["messages"]) {
  return messages.filter((m) => boundaryId(m.message) !== null);
}

async function lintFixtureAt(fixture: string, relPath: string) {
  const code = fs.readFileSync(path.join(FIXTURES, fixture), "utf8");
  const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, relPath) });
  return result.messages;
}

/** [line, prefix, ruleId, severity] for every boundary message, in report order. */
async function boundaryAt(fixture: string, relPath: string) {
  return boundaryMessages(await lintFixtureAt(fixture, relPath)).map((m) => [
    m.line,
    boundaryId(m.message),
    m.ruleId,
    m.severity,
  ]);
}

const A1_ROUTES = [
  "app/api/r/[token]/route.ts",
  "app/r/[token]/page.tsx",
  "app/api/reports/view/route.ts",
  "app/reports/view/page.tsx",
  "app/api/reschedule/[token]/route.ts",
];

type Expected = Array<[number, Prefix, string]>;
const imp = (line: number): [number, Prefix, string] => [line, "P1-34:", IMPORTS];
const syn = (line: number, prefix: Prefix = "P1-34:"): [number, Prefix, string] => [line, prefix, SYNTAX];
const DIRECTIVE = "clinicos/no-boundary-directive";
const dir = (line: number): [number, Prefix, string] => [line, "P1-34:", DIRECTIVE];
const REQUIRE_LINES: Expected = [1, 1, 2, 4, 4, 6, 7].map((l) => syn(l));
const SECRET_PIECES_LINES: Expected = [2, 2, 2, 2, 3, 3, 3, 6, 7, 8, 9].map((l) => syn(l));
const TOOLING_LINES: Expected = [2, 3, 4, 5].map((l) => imp(l));

const UTC_LINES: Expected = [3, 4, 5, 6, 7, 8, 9].map((l) => syn(l, "P1-21:"));
const ENV_LINES: Expected = [1, 2, 3, 5].map((l) => syn(l, "P1-15:"));
const CONSOLE_LINES: Expected = [2, 3, 4].map((l) => syn(l, "P1-25:"));
// 03-13 (High re-verify, Low): node:process import, member, computed, globalThis, destructured and require forms.
const RAW_STREAM_LINES: Expected = [1, 4, 5, 6, 7, 10].map((l) => syn(l, "P1-25:"));

const FAILING: Array<[string, string, string, Expected]> = [
  // ADR-0005 D2/D4: the factory outside the allow-list and the register.
  ["a server action importing the system factory", "action-factory-import.ts", "features/patients/actions.ts", [imp(2)]],
  ["a dashboard page importing the system factory", "page-factory-import.tsx", "app/(dashboard)/fixture/page.tsx", [imp(1)]],
  ["a feature service importing the system factory", "factory-import.ts", "features/patients/service.ts", [imp(1)]],
  ["an A1 share route importing the factory itself", "factory-import.ts", "app/api/r/[token]/route.ts", [imp(1)]],
  ["the cookie-client module importing the factory", "factory-import.ts", "lib/supabase/server.ts", [imp(1)]],
  // 03-13c M-ALLOWLIST: the enqueue surface is not the allow-list (ADR-0005 D2); only lib/jobs/internal/** is.
  ["the lib/jobs enqueue surface wrapping the factory", "factory-import.ts", "lib/jobs/x.ts", [imp(1)]],
  // V2-04 04-02: the enqueue module itself (04-03a) and the runner auth module never get the system client.
  ["lib/jobs/enqueue.ts importing the system factory", "factory-import.ts", "lib/jobs/enqueue.ts", [imp(1)]],
  ["lib/jobs/auth.ts importing the system factory", "factory-import.ts", "lib/jobs/auth.ts", [imp(1)]],
  ["a feature importing a factory wrapper from lint-fixtures/, scripts/, tests/, docs/", "tooling-import.ts", "features/patients/service.ts", TOOLING_LINES],
  ["a register zone importing the tooling trees", "tooling-import.ts", "lib/webhooks/x.ts", TOOLING_LINES],
  // Proposed ADR-0005 A3 (04-03c): features/auth/system from the Send Email hook route only; nothing else there.
  ["features/auth/system from another auth route", "auth-system-import.ts", "app/api/auth/other/route.ts", [imp(1)]],
  ["features/auth/system from a feature service", "auth-system-import.ts", "features/patients/service.ts", [imp(1)]],
  ["the factory itself in the Send Email hook route", "factory-import.ts", "app/api/auth/send-email/route.ts", [imp(1)]],
  ["another domain's system module in the Send Email hook route", "other-feature-system-import.ts", "app/api/auth/send-email/route.ts", [imp(1)]],
  ["features/sharing/system in the Send Email hook route", "sharing-system-import.ts", "app/api/auth/send-email/route.ts", [imp(1)]],
  ["a relative path to the factory", "traversal-factory-import.ts", "features/patients/service.ts", [imp(1)]],
  ["a re-export of the factory", "reexport-factory.ts", "lib/db/system-reexport.ts", [imp(1)]],
  // features/*/system and ADR-0005 A1.
  ["a feature service importing features/sharing/system", "sharing-system-import.ts", "features/patients/service.ts", [imp(1)]],
  ["a non-A1 route importing features/sharing/system", "sharing-system-import.ts", "app/api/patients/route.ts", [imp(1)]],
  ["a non-A1 page importing features/sharing/system", "sharing-system-import.ts", "app/(dashboard)/patients/page.tsx", [imp(1)]],
  ["an A1 route importing another domain's system module", "other-feature-system-import.ts", "app/api/reports/view/route.ts", [imp(1)]],
  ["an action importing its own domain's ./system", "relative-system-import.ts", "features/billing/actions.ts", [imp(2)]],
  // Dynamic forms: banned everywhere, including the allow-list.
  ["dynamic import() of the factory", "dynamic-import-factory.ts", "features/patients/service.ts", [syn(2)]],
  ["dynamic import() of the factory on an allowed path", "dynamic-import-factory.ts", "app/api/webhooks/x/route.ts", [syn(2)]],
  ["require() of the factory", "require-factory.ts", "features/patients/service.ts", [syn(1)]],
  ["require() of the factory on an allowed path", "require-factory.ts", "features/x/system.ts", [syn(1)]],
  ["a computed import() specifier", "computed-import.ts", "features/patients/service.ts", [syn(3)]],
  ["dynamic import() of @supabase/supabase-js", "dynamic-import-supabase-js.ts", "features/patients/service.ts", [syn(2)]],
  // Second factory: createClient value import + the secret-key identifier.
  ["a createClient value import and the secret key in a feature", "second-factory.ts", "features/reports/service.ts", [imp(2), syn(6)]],
  ["a namespace import of @supabase/supabase-js", "namespace-supabase-js.ts", "features/patients/service.ts", [imp(1)]],
  ["a createServerClient value import in a feature", "ssr-client-import.ts", "features/auth/service.ts", [imp(1)]],
  // 03-13c M-LINT: every other way to build a client from a Supabase package.
  ["new SupabaseClient in a feature", "supabase-client-class.ts", "features/patients/service.ts", [imp(1)]],
  ["new SupabaseClient in the factory module (createClient only)", "supabase-client-class.ts", "lib/supabase/system.ts", [imp(1)]],
  ["GoTrueAdminApi and @supabase/auth-js in a feature", "gotrue-admin.ts", "features/patients/service.ts", [imp(1), imp(2)]],
  ["GoTrueAdminApi and @supabase/auth-js in the factory module", "gotrue-admin.ts", "lib/supabase/system.ts", [imp(1), imp(2)]],
  ["GoTrueAdminApi and @supabase/auth-js in a cookie-session module", "gotrue-admin.ts", "lib/supabase/server.ts", [imp(1), imp(2)]],
  ["@supabase/postgrest-js in a feature", "postgrest-client.ts", "features/patients/service.ts", [imp(1)]],
  ["@supabase/postgrest-js in the factory module", "postgrest-client.ts", "lib/supabase/system.ts", [imp(1)]],
  ["@supabase/ssr and supabase-js subpaths in a feature", "supabase-subpath.ts", "features/auth/service.ts", [imp(2), imp(3)]],
  ["@supabase/ssr and supabase-js subpaths in a cookie-session module", "supabase-subpath.ts", "lib/supabase/server.ts", [imp(2), imp(3)]],
  ["@supabase/ssr and supabase-js subpaths in the factory module", "supabase-subpath.ts", "lib/supabase/system.ts", [imp(2), imp(3)]],
  ["the secret-key name built from pieces, and computed/spread/enumerated env reads", "computed-secret-key.ts", "features/settings/service.ts", SECRET_PIECES_LINES],
  ["require aliased, module.require, a computed require and createRequire", "require-forms.ts", "features/patients/service.ts", REQUIRE_LINES],
  ["the require forms on an allowed path", "require-forms.ts", "lib/jobs/internal/runner.ts", REQUIRE_LINES],
  ["inline directives that silence or blanket the gates (inline configuration off)", "inline-disable.ts", "features/patients/service.ts", [dir(1), imp(2), dir(3), dir(4)]],
  ["the secret-key names as strings in a feature", "secret-key-names.ts", "features/settings/service.ts", [syn(1), syn(2)]],
  // lib/jobs internals (ADR-0005 D2).
  ["an action importing a lib/jobs internal", "jobs-internal-import.ts", "features/patients/actions.ts", [imp(3)]],
  ["a register route importing a lib/jobs internal", "jobs-internal-import.ts", "app/api/v1/x/route.ts", [imp(3)]],
  ["the jobs enqueue surface importing a lib/jobs internal", "jobs-internal-import.ts", "lib/jobs/enqueue.ts", [imp(3)]],
  ["the jobs enqueue surface importing ./internal", "jobs-internal-relative.ts", "lib/jobs/enqueue.ts", [imp(2)]],
  // P1-15 / P1-25 / P1-21.
  ["process.env in a feature", "process-env.ts", "features/patients/service.ts", ENV_LINES],
  ["process.env in the system factory", "process-env.ts", "lib/supabase/system.ts", ENV_LINES],
  // V2-04 04-05a: the ops/** tooling allowance does not leak into lib/.
  ["process.env in lib (outside the ops/** tooling zone)", "process-env.ts", "lib/x.ts", ENV_LINES],
  ["console in a feature", "console.ts", "features/billing/service.ts", CONSOLE_LINES],
  ["console in the server logger", "console.ts", "lib/log/index.ts", CONSOLE_LINES],
  ["console in the env module", "console.ts", "lib/env.ts", CONSOLE_LINES],
  ["process.stdout/stderr in a feature", "raw-stream.ts", "features/billing/service.ts", RAW_STREAM_LINES],
  ["process.stdout/stderr in a route handler", "raw-stream.ts", "app/api/x/route.ts", RAW_STREAM_LINES],
  ["process.stdout/stderr in the env module", "raw-stream.ts", "lib/env.ts", RAW_STREAM_LINES],
  ["process.stdout/stderr in instrumentation", "raw-stream.ts", "instrumentation.ts", RAW_STREAM_LINES],
  ["the server logger imported into \"use client\" code", "client-server-logger.tsx", "components/fixture/widget.tsx", [syn(2, "P1-25:"), syn(3, "P1-25:")]],
  ["each UTC-date pattern in a feature", "utc-date-patterns.ts", "features/visits/service.ts", UTC_LINES],
  ["each UTC-date pattern outside lib/datetime", "utc-date-patterns.ts", "lib/log/client.ts", UTC_LINES],
];

const PASSING: Array<[string, string]> = [
  ...A1_ROUTES.map((route): [string, string] => ["sharing-system-import.ts", route]),
  ["factory-import.ts", "app/api/webhooks/x/route.ts"],
  ["factory-import.ts", "app/api/jobs/run/route.ts"],
  ["factory-import.ts", "lib/jobs/internal/runner.ts"],
  ["factory-import.ts", "features/x/system.ts"],
  // Exception register (ADR-0005): P1-37 and V2-04 entries.
  ["factory-import.ts", "app/api/v1/x/route.ts"],
  ["factory-import.ts", "lib/api/x.ts"],
  ["factory-import.ts", "app/api/cron/x/route.ts"],
  ["factory-import.ts", "lib/messaging/dispatcher.ts"],
  ["factory-import.ts", "lib/webhooks/x.ts"],
  // Proposed ADR-0005 A3 (V2-04 04-03c, R-43).
  ["auth-system-import.ts", "app/api/auth/send-email/route.ts"],
  ["other-feature-system-import.ts", "features/sharing/system.ts"],
  ["other-feature-system-import.ts", "app/api/webhooks/messaging/x/route.ts"],
  ["second-factory.ts", "lib/supabase/system.ts"],
  ["ssr-client-import.ts", "lib/supabase/server.ts"],
  ["ssr-client-import.ts", "lib/supabase/client.ts"],
  ["ssr-client-import.ts", "proxy.ts"],
  ["type-imports.ts", "features/patients/service.ts"],
  ["secret-key-names.ts", "lib/env.ts"],
  ["secret-key-names.ts", "lib/env-server.ts"],
  ["process-env.ts", "lib/env.ts"],
  ["process-env.ts", "lib/env-server.ts"],
  ["process-env.ts", "next.config.ts"],
  ["process-env.ts", "instrumentation.ts"],
  ["process-env.ts", "lib/log/client.ts"],
  ["console.ts", "lib/log/client.ts"],
  ["raw-stream.ts", "lib/log/index.ts"],
  ["raw-stream.ts", "lib/log/client.ts"],
  ["raw-stream.ts", "lib/observability/console-scrub.ts"],
  ["client-reporter.tsx", "components/fixture/widget.tsx"],
  ["utc-date-patterns.ts", "lib/datetime/x.ts"],
  ["jobs-internal-import.ts", "app/api/jobs/run/route.ts"],
  ["jobs-internal-import.ts", "lib/jobs/internal/registry.ts"],
  // ADR-0005 D4: tests and scripts are excepted.
  ["factory-import.ts", "tests/fixture/x.spec.ts"],
  ["second-factory.ts", "scripts/fixture.ts"],
  ["console.ts", "scripts/fixture.ts"],
  ["raw-stream.ts", "scripts/fixture.ts"],
  ["process-env.ts", "tests/fixture/x.spec.ts"],
  // V2-04 04-05a: ops/** (backup and restore-drill tooling) has the scripts/** exceptions.
  ["process-env.ts", "ops/x.ts"],
  ["console.ts", "ops/x.ts"],
  // 03-13c: the env modules may build env names; tooling may import its own trees and use require.
  ["computed-secret-key.ts", "lib/env.ts"],
  ["computed-secret-key.ts", "lib/env-server.ts"],
  ["tooling-import.ts", "tests/fixture/x.spec.ts"],
  ["require-forms.ts", "scripts/fixture.ts"],
  ["supabase-client-class.ts", "tests/fixture/x.spec.ts"],
];

describe("P1-34 boundary lint gates: bypass fixtures fail lint", () => {
  it.each(FAILING)("%s", async (_name, fixture, relPath, expected) => {
    const got = await boundaryAt(fixture, relPath);
    expect(got).toEqual(expected.map(([line, prefix, rule]) => [line, prefix, rule, 2]));
  }, 60_000);
});

describe("P1-34 boundary lint gates: allowed paths stay clean", () => {
  it.each(PASSING)("%s at %s", async (fixture, relPath) => {
    expect(await boundaryAt(fixture, relPath)).toEqual([]);
  }, 60_000);
});

/**
 * V2-04 04-02: the real runner route and registry (they import the system factory and the jobs internals) lint clean
 * where they live, and the same source fails when it is moved to a request-path zone: the pass comes from the
 * `app/api/jobs/**` / `lib/jobs/internal/**` zones, not from the content.
 */
describe("P1-34 boundary lint gates: the real jobs runner files (04-02)", () => {
  const real = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
  async function boundaryOfSourceAt(source: string, relPath: string) {
    const [result] = await eslint.lintText(source, { filePath: path.join(ROOT, relPath) });
    return boundaryMessages(result.messages).map((m) => [boundaryId(m.message), m.ruleId]);
  }

  it.each(["app/api/jobs/run/route.ts", "lib/jobs/internal/registry.ts", "lib/jobs/internal/handlers/drill.ts", "lib/jobs/auth.ts"])(
    "%s lints clean where it lives",
    async (rel) => {
      expect(await boundaryOfSourceAt(real(rel), rel)).toEqual([]);
    },
    60_000,
  );

  it.each([
    ["a server action (the factory and two jobs internals)", "features/patients/actions.ts", 3],
    ["a register route (the two jobs internals; the register may hold the factory until P1-37)", "app/api/v1/x/route.ts", 2],
    ["the enqueue surface (the factory and two jobs internals)", "lib/jobs/enqueue.ts", 3],
  ])("the runner route's source fails as %s", async (_label, relPath, count) => {
    expect(await boundaryOfSourceAt(real("app/api/jobs/run/route.ts"), relPath)).toEqual(
      Array.from({ length: count }, () => ["P1-34:", IMPORTS]),
    );
  }, 60_000);
});

describe("P1-34 boundary lint gates: inline directives (03-13c M-LINT)", () => {
  it("with inline configuration on (`npx eslint .`), the directive rule still fails a directive that names a gate", async () => {
    const withInline = new ESLint({ cwd: ROOT, ignore: false });
    const code = fs.readFileSync(path.join(FIXTURES, "inline-disable.ts"), "utf8");
    const [result] = await withInline.lintText(code, { filePath: path.join(ROOT, "features/patients/service.ts") });
    const got = boundaryMessages(result.messages).map((m) => [m.line, m.ruleId, m.severity]);
    // Line 4's blanket `/* eslint-disable */` silences everything after it, including its own report; the spec and the
    // census lint with inline configuration off, where it is reported (above).
    expect(got).toEqual([
      [1, DIRECTIVE, 2],
      [3, DIRECTIVE, 2],
    ]);
  }, 60_000);

  it("tooling may carry directives (the rule is off there)", async () => {
    expect(await boundaryAt("inline-disable.ts", "tests/fixture/x.spec.ts")).toEqual([]);
  }, 60_000);
});

describe("P1-34 boundary lint gates: zones keep the base gates", () => {
  // Every override zone spreads the full base list (flat-config option lists replace, never merge): the AUTH-01 and
  // P0-13 bans still fire there, tooling included.
  const ZONE_PATHS = [
    "app/api/v1/x/route.ts",
    "app/api/cron/x/route.ts",
    "app/api/auth/send-email/route.ts",
    "app/api/webhooks/x/route.ts",
    "app/api/jobs/run/route.ts",
    "lib/api/x.ts",
    "lib/webhooks/x.ts",
    "lib/messaging/dispatcher.ts",
    "lib/jobs/internal/runner.ts",
    "features/x/system.ts",
    "lib/supabase/system.ts",
    "lib/supabase/server.ts",
    "proxy.ts",
    "lib/env.ts",
    "next.config.ts",
    "lib/log/client.ts",
    "lib/log/index.ts",
    "lib/observability/x.ts",
    "lib/datetime/x.ts",
    ...A1_ROUTES,
    "tests/fixture/x.spec.ts",
    "scripts/fixture.ts",
  ];
  it.each(ZONE_PATHS)("AUTH-01 and P0-13 fire at %s", async (relPath) => {
    const messages = (await lintFixtureAt("base-gates.ts", relPath)).filter((m) => m.ruleId === SYNTAX);
    const prefixes = messages.map((m) => m.message.split(":")[0]).sort();
    expect(prefixes).toEqual(["AUTH-01", "P0-13"]);
    expect(messages.every((m) => m.severity === 2)).toBe(true);
  }, 60_000);
});

describe("P1-34 boundary lint gates: the real tree", () => {
  it("app code carries 0 boundary messages", async () => {
    const results = await eslint.lintFiles(
      ["app", "components", "features", "lib", "types", "proxy.ts", "instrumentation.ts", "next.config.ts"].map((p) =>
        path.join(ROOT, p),
      ),
    );
    expect(results.length).toBeGreaterThan(250);
    const flagged = results.flatMap((r) =>
      boundaryMessages(r.messages).map((m) => `${path.relative(ROOT, r.filePath)}:${m.line} ${boundaryId(m.message)}`),
    );
    expect(flagged).toEqual([]);
  }, 180_000);
});

type Counters = {
  files_linted: number;
  boundary_messages: Record<"P1-34" | "P1-21" | "P1-25" | "P1-15" | "P0-12", number> & { flagged: string[] };
  boundary_directives: string[];
  p1_34_boundary_messages: number;
  utc_today_messages: number;
  service_role_factories: string[];
  system_module_importers: { factory: string[]; feature_system: string[]; non_canonical: string[] };
};

// The ADR-0005 allow-list and exception register, written out independently of eslint.config.mjs.
const ALLOWED_IMPORTER = [
  /^lib\/jobs\/internal\//, // ADR-0005 D2: the internals only (03-13c M-ALLOWLIST)
  /^features\/[^/]+\/system\.ts$/,
  /^app\/api\/(jobs|webhooks)\//,
  /^app\/api\/v1\//, // register, P1-37
  /^lib\/api\//, // register, P1-37
  /^app\/api\/cron\//, // register, V2-04
  /^lib\/messaging\/dispatcher\.ts$/, // register, V2-04
  /^lib\/webhooks\//, // register, V2-04
];
// Proposed ADR-0005 A3 (V2-04 04-03c): a feature_system importer only (never the factory).
const A3_ROUTE = "app/api/auth/send-email/route.ts";

describe("P1-34 acceptance counters (scripts/ci/p1-34-counters.mjs, static-checks.json)", () => {
  it("the real tree: 1 service-role factory, 0 boundary messages, every system importer allowed", async () => {
    const c = (await p134Counters({ cwd: ROOT })) as Counters;
    expect(c.files_linted).toBeGreaterThan(250);
    expect(c.service_role_factories).toEqual(["lib/supabase/system.ts"]);
    expect(c.p1_34_boundary_messages).toBe(0);
    expect(c.utc_today_messages).toBe(0);
    expect(c.boundary_messages).toEqual({ "P1-34": 0, "P1-21": 0, "P1-25": 0, "P1-15": 0, "P0-12": 0, flagged: [] });
    expect(c.boundary_directives).toEqual([]);
    expect(c.system_module_importers.factory.length).toBeGreaterThan(0);
    expect(c.system_module_importers.factory.filter((f) => !ALLOWED_IMPORTER.some((re) => re.test(f)))).toEqual([]);
    expect(
      c.system_module_importers.feature_system.filter(
        (f) => !A1_ROUTES.includes(f) && f !== A3_ROUTE && !ALLOWED_IMPORTER.some((re) => re.test(f)),
      ),
    ).toEqual([]);
    expect(c.system_module_importers.non_canonical).toEqual([]);
    expect(c.system_module_importers.factory).not.toContain(A3_ROUTE);
  }, 180_000);

  it("the counters see the fixtures' second factories, system importers, directives and UTC patterns", async () => {
    const c = (await p134Counters({ cwd: ROOT, targets: ["lint-fixtures/p1-34"], ignore: false })) as Counters;
    const names = (files: string[]) => files.map((f) => path.basename(f)).sort();
    expect(names(c.service_role_factories)).toEqual([
      "gotrue-admin.ts",
      "namespace-supabase-js.ts",
      "postgrest-client.ts",
      "second-factory.ts",
      "supabase-client-class.ts",
      "supabase-subpath.ts",
    ]);
    expect(names(c.system_module_importers.factory)).toEqual([
      "action-factory-import.ts",
      "factory-import.ts",
      "inline-disable.ts",
      "page-factory-import.tsx",
      "reexport-factory.ts",
    ]);
    // The import a directive hides from `npx eslint .` is still counted (inline configuration off) and listed.
    expect(c.boundary_directives).toContain("lint-fixtures/p1-34/inline-disable.ts:2 @typescript-eslint/no-restricted-imports");
    expect(c.boundary_messages.flagged).toContain(
      "lint-fixtures/p1-34/inline-disable.ts:2 P1-34 @typescript-eslint/no-restricted-imports",
    );
    expect(names(c.system_module_importers.feature_system)).toEqual([
      "auth-system-import.ts",
      "other-feature-system-import.ts",
      "sharing-system-import.ts",
    ]);
    expect(names(c.system_module_importers.non_canonical)).toEqual([
      "relative-system-import.ts",
      "traversal-factory-import.ts",
    ]);
    expect(c.utc_today_messages).toBe(7);
    expect(c.p1_34_boundary_messages).toBeGreaterThan(0);
  }, 180_000);
});
