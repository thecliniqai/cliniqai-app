/**
 * P1-34 boundary lint gates (V2-03 03-04; ADR-0005 D2/D4 + A1, C50 a/d/e; P1-21, P1-25, P1-15). Runs ESLint itself:
 * each fixture in lint-fixtures/p1-34/ is linted as text at a virtual repository path (README there) so the real
 * `files:` globs of eslint.config.mjs decide, then the exact rule, line and backlog prefix of every boundary message
 * is asserted. Last, the real app code is linted and must carry 0 boundary messages (the roadmap acceptance
 * "1 service-role factory, 0 service-role imports outside the allow-list and the register").
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
  eslint = new ESLint({ cwd: ROOT, ignore: false });
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

const UTC_LINES: Expected = [3, 4, 5, 6, 7, 8, 9].map((l) => syn(l, "P1-21:"));
const ENV_LINES: Expected = [1, 2, 3, 5].map((l) => syn(l, "P1-15:"));
const CONSOLE_LINES: Expected = [2, 3, 4].map((l) => syn(l, "P1-25:"));

const FAILING: Array<[string, string, string, Expected]> = [
  // ADR-0005 D2/D4: the factory outside the allow-list and the register.
  ["a server action importing the system factory", "action-factory-import.ts", "features/patients/actions.ts", [imp(2)]],
  ["a dashboard page importing the system factory", "page-factory-import.tsx", "app/(dashboard)/fixture/page.tsx", [imp(1)]],
  ["a feature service importing the system factory", "factory-import.ts", "features/patients/service.ts", [imp(1)]],
  ["an A1 share route importing the factory itself", "factory-import.ts", "app/api/r/[token]/route.ts", [imp(1)]],
  ["the cookie-client module importing the factory", "factory-import.ts", "lib/supabase/server.ts", [imp(1)]],
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
  ["the secret-key names as strings in a feature", "secret-key-names.ts", "features/settings/service.ts", [syn(1), syn(2)]],
  // lib/jobs internals (ADR-0005 D2).
  ["an action importing a lib/jobs internal", "jobs-internal-import.ts", "features/patients/actions.ts", [imp(3)]],
  ["a register route importing a lib/jobs internal", "jobs-internal-import.ts", "app/api/v1/x/route.ts", [imp(3)]],
  ["the jobs enqueue surface importing a lib/jobs internal", "jobs-internal-import.ts", "lib/jobs/enqueue.ts", [imp(3)]],
  ["the jobs enqueue surface importing ./internal", "jobs-internal-relative.ts", "lib/jobs/enqueue.ts", [imp(2)]],
  // P1-15 / P1-25 / P1-21.
  ["process.env in a feature", "process-env.ts", "features/patients/service.ts", ENV_LINES],
  ["process.env in the system factory", "process-env.ts", "lib/supabase/system.ts", ENV_LINES],
  ["console in a feature", "console.ts", "features/billing/service.ts", CONSOLE_LINES],
  ["console in the server logger", "console.ts", "lib/log/index.ts", CONSOLE_LINES],
  ["console in the env module", "console.ts", "lib/env.ts", CONSOLE_LINES],
  ["the server logger imported into \"use client\" code", "client-server-logger.tsx", "components/fixture/widget.tsx", [syn(2, "P1-25:"), syn(3, "P1-25:")]],
  ["each UTC-date pattern in a feature", "utc-date-patterns.ts", "features/visits/service.ts", UTC_LINES],
  ["each UTC-date pattern outside lib/datetime", "utc-date-patterns.ts", "lib/log/client.ts", UTC_LINES],
];

const PASSING: Array<[string, string]> = [
  ...A1_ROUTES.map((route): [string, string] => ["sharing-system-import.ts", route]),
  ["factory-import.ts", "app/api/webhooks/x/route.ts"],
  ["factory-import.ts", "app/api/jobs/run/route.ts"],
  ["factory-import.ts", "lib/jobs/x.ts"],
  ["factory-import.ts", "lib/jobs/internal/runner.ts"],
  ["factory-import.ts", "features/x/system.ts"],
  // Exception register (ADR-0005): P1-37 and V2-04 entries.
  ["factory-import.ts", "app/api/v1/x/route.ts"],
  ["factory-import.ts", "lib/api/x.ts"],
  ["factory-import.ts", "app/api/cron/x/route.ts"],
  ["factory-import.ts", "lib/messaging/dispatcher.ts"],
  ["factory-import.ts", "lib/webhooks/x.ts"],
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
  ["client-reporter.tsx", "components/fixture/widget.tsx"],
  ["utc-date-patterns.ts", "lib/datetime/x.ts"],
  ["jobs-internal-import.ts", "app/api/jobs/run/route.ts"],
  ["jobs-internal-import.ts", "lib/jobs/internal/registry.ts"],
  // ADR-0005 D4: tests and scripts are excepted.
  ["factory-import.ts", "tests/fixture/x.spec.ts"],
  ["second-factory.ts", "scripts/fixture.ts"],
  ["console.ts", "scripts/fixture.ts"],
  ["process-env.ts", "tests/fixture/x.spec.ts"],
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

describe("P1-34 boundary lint gates: zones keep the base gates", () => {
  // Every override zone spreads the full base list (flat-config option lists replace, never merge): the AUTH-01 and
  // P0-13 bans still fire there, tooling included.
  const ZONE_PATHS = [
    "app/api/v1/x/route.ts",
    "app/api/cron/x/route.ts",
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
  boundary_messages: Record<"P1-34" | "P1-21" | "P1-25" | "P1-15", number> & { flagged: string[] };
  p1_34_boundary_messages: number;
  utc_today_messages: number;
  service_role_factories: string[];
  system_module_importers: { factory: string[]; feature_system: string[]; non_canonical: string[] };
};

// The ADR-0005 allow-list and exception register, written out independently of eslint.config.mjs.
const ALLOWED_IMPORTER = [
  /^lib\/jobs\//,
  /^features\/[^/]+\/system\.ts$/,
  /^app\/api\/(jobs|webhooks)\//,
  /^app\/api\/v1\//, // register, P1-37
  /^lib\/api\//, // register, P1-37
  /^app\/api\/cron\//, // register, V2-04
  /^lib\/messaging\/dispatcher\.ts$/, // register, V2-04
  /^lib\/webhooks\//, // register, V2-04
];

describe("P1-34 acceptance counters (scripts/ci/p1-34-counters.mjs, static-checks.json)", () => {
  it("the real tree: 1 service-role factory, 0 boundary messages, every system importer allowed", async () => {
    const c = (await p134Counters({ cwd: ROOT })) as Counters;
    expect(c.files_linted).toBeGreaterThan(250);
    expect(c.service_role_factories).toEqual(["lib/supabase/system.ts"]);
    expect(c.p1_34_boundary_messages).toBe(0);
    expect(c.utc_today_messages).toBe(0);
    expect(c.boundary_messages).toEqual({ "P1-34": 0, "P1-21": 0, "P1-25": 0, "P1-15": 0, flagged: [] });
    expect(c.system_module_importers.factory.length).toBeGreaterThan(0);
    expect(c.system_module_importers.factory.filter((f) => !ALLOWED_IMPORTER.some((re) => re.test(f)))).toEqual([]);
    expect(
      c.system_module_importers.feature_system.filter(
        (f) => !A1_ROUTES.includes(f) && !ALLOWED_IMPORTER.some((re) => re.test(f)),
      ),
    ).toEqual([]);
    expect(c.system_module_importers.non_canonical).toEqual([]);
  }, 180_000);

  it("the counters see the fixtures' second factories, system importers and UTC patterns", async () => {
    const c = (await p134Counters({ cwd: ROOT, targets: ["lint-fixtures/p1-34"], ignore: false })) as Counters;
    const names = (files: string[]) => files.map((f) => path.basename(f)).sort();
    expect(names(c.service_role_factories)).toEqual(["namespace-supabase-js.ts", "second-factory.ts"]);
    expect(names(c.system_module_importers.factory)).toEqual([
      "action-factory-import.ts",
      "factory-import.ts",
      "page-factory-import.tsx",
      "reexport-factory.ts",
    ]);
    expect(names(c.system_module_importers.feature_system)).toEqual([
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
