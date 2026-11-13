// eslint-config-next 16 ships native flat configs (V2-03 03-06); the FlatCompat / @eslint/eslintrc bridge is gone.
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/**
 * AUTH-01 gates (AUTH_REDESIGN §11, 01-06): no code path may create users through OTP or sign in by a mailbox
 * code. Login is password-only; the only OTP use is the recovery code (`verifyOtp` type `recovery`).
 * Proven by tests/security/auth-lint-gates.spec.ts against the fixtures in lint-fixtures/auth-01/.
 */
const AUTH01_GATES = [
  {
    selector: "Property[key.name=/^(shouldCreateUser|create_user)$/], Property[key.value=/^(shouldCreateUser|create_user)$/]",
    message: "AUTH-01: OTP user creation is banned. Users are created only by seeds/admin flows (AUTH-06/07).",
  },
  {
    selector:
      "MemberExpression[property.name=/^(signInWithOtp|signInWithIdToken|generateLink)$/], MemberExpression[property.value=/^(signInWithOtp|signInWithIdToken|generateLink)$/]",
    message: "AUTH-01: OTP/magic-link/ID-token sign-in and admin.generateLink are banned. Use password sign-in.",
  },
  {
    selector:
      "ObjectPattern > Property[key.name=/^(signInWithOtp|signInWithIdToken|generateLink)$/]",
    message: "AUTH-01: OTP/magic-link/ID-token sign-in and admin.generateLink are banned. Use password sign-in.",
  },
  {
    selector: "Identifier[name=/devOtp/i]",
    message: "AUTH-01: dev OTP shortcuts are banned.",
  },
];

/**
 * P0-01 gates (ADR-0005 Verification 3, plan 01-01d): no `"use server"` export accepts the acting principal from the
 * caller. On modules with the `"use server"` directive, every top-level function (exported directly, or exportable
 * through `export { … }`) is checked: a parameter, a default-assigned or rest parameter, a destructured parameter
 * field or a field of an inline parameter type named `*Override`, `actorSession`, `session`, `client`, `actorId`,
 * `createdBy`/`recordedBy`/`signedBy` (or snake_case) or an acting `tenantId`/`tenant_id` is an error. Target ids
 * (`target_tenant_id`, `doctor_id`, `patientId`) do not match. Named parameter types are covered by the type-aware
 * inventory, `scripts/inventory-server-actions.ts`. Proven by tests/security/override-lint-gates.spec.ts against
 * lint-fixtures/p0-01/.
 */
const P001_BANNED_PARAM =
  "/Override$|^(actorSession|session|client|actorId|actor_id|createdBy|created_by|recordedBy|recorded_by|signedBy|signed_by|tenantId|tenant_id)$/";
const P001_USE_SERVER = 'Program:has(> ExpressionStatement[directive="use server"])';
const P001_TOP_LEVEL_FUNCTIONS = [
  `${P001_USE_SERVER} > FunctionDeclaration`,
  `${P001_USE_SERVER} > ExportNamedDeclaration > FunctionDeclaration`,
  `${P001_USE_SERVER} > ExportDefaultDeclaration > :function`,
  `${P001_USE_SERVER} > VariableDeclaration > VariableDeclarator > :function`,
  `${P001_USE_SERVER} > ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > :function`,
];
const P001_PARAM_FORMS = [
  `> Identifier.params[name=${P001_BANNED_PARAM}]`,
  `> AssignmentPattern.params > Identifier.left[name=${P001_BANNED_PARAM}]`,
  `> RestElement.params > Identifier.argument[name=${P001_BANNED_PARAM}]`,
  `> :matches(ObjectPattern.params, AssignmentPattern.params > ObjectPattern.left) Property > Identifier.key[name=${P001_BANNED_PARAM}]`,
  `> :matches(ObjectPattern.params, AssignmentPattern.params > ObjectPattern.left) Property > Literal.key[value=${P001_BANNED_PARAM}]`,
  `> :matches(Identifier, ObjectPattern, AssignmentPattern).params TSTypeAnnotation TSPropertySignature > :matches(Identifier.key[name=${P001_BANNED_PARAM}], Literal.key[value=${P001_BANNED_PARAM}])`,
];
const P001_ACTION_GATES = [
  {
    selector: P001_TOP_LEVEL_FUNCTIONS.flatMap((fn) => P001_PARAM_FORMS.map((form) => `${fn} ${form}`)).join(", "),
    message:
      "P0-01: a \"use server\" export must not accept the acting principal (override, session, client, actor or acting tenant). Derive it from requireServiceContext()/resolveServiceContext() (ADR-0005 D1).",
  },
];

/**
 * P0-01 schema gate (ADR-0005 D1 "as an input field"): zod object literals in `features/** /schema.ts` describe
 * caller input, so they must not carry the acting actor or tenant. Stored shapes that include attribution are plain
 * TypeScript types (e.g. `Vitals` in features/consultation/schema.ts), not zod input schemas. `.omit({ … })` and
 * `target_tenant_id` are allowed.
 */
const P001_BANNED_SCHEMA_KEY =
  "/^(created_by|recorded_by|signed_by|actor_id|tenant_id|createdBy|recordedBy|signedBy|actorId|tenantId)$/";
const P001_SCHEMA_GATES = [
  {
    selector: [
      `CallExpression[callee.property.name=/^(object|strictObject|extend)$/] > ObjectExpression.arguments Property > Identifier.key[name=${P001_BANNED_SCHEMA_KEY}]`,
      `CallExpression[callee.property.name=/^(object|strictObject|extend)$/] > ObjectExpression.arguments Property > Literal.key[value=${P001_BANNED_SCHEMA_KEY}]`,
      `CallExpression[callee.name=/^(object|strictObject)$/] > ObjectExpression.arguments Property > Identifier.key[name=${P001_BANNED_SCHEMA_KEY}]`,
      `CallExpression[callee.name=/^(object|strictObject)$/] > ObjectExpression.arguments Property > Literal.key[value=${P001_BANNED_SCHEMA_KEY}]`,
    ].join(", "),
    message:
      "P0-01: an input schema must not carry the acting actor or tenant (created_by/recorded_by/signed_by/actor_id/tenant_id). The server sets them from the session (ADR-0005 D1).",
  },
];

/**
 * P0-13 gates (V2-02 02-06, IR-F3/AR-M2c): every server entry point must be one the guard inventory
 * (scripts/inventory-server-actions.ts) and so tests/security/guard-*.spec.ts can see. A function-level (inline)
 * `"use server"` action and a route handler named `route.{js,jsx,tsx,mjs,cjs}` are both served by Next but not
 * inventoried. The inventory flags the same shapes. Proven by tests/security/p0-13-lint-gates.spec.ts.
 */
const P013_INLINE_ACTION_GATES = [
  {
    selector: ':function > BlockStatement > ExpressionStatement[directive="use server"]',
    message:
      "P0-13: inline \"use server\" actions are not inventoried by the guard test. Move the action to a \"use server\" module and give it a guard-manifest entry.",
  },
];
const P013_ROUTE_FILE_GATES = [
  {
    selector: "Program",
    message: "P0-13: route handlers must be named route.ts so the guard inventory and tests/security/guard-routes.spec.ts see them.",
  },
];

// Flat-config `no-restricted-syntax` options do not merge across config objects: each file set gets one combined list.
const BASE_RESTRICTED_SYNTAX = [...AUTH01_GATES, ...P001_ACTION_GATES, ...P013_INLINE_ACTION_GATES];

/**
 * V2-03 03-04 boundary gates (P1-34 / ADR-0005 D2+D4+A1, P1-21, P1-25, P1-15). Proven by
 * tests/security/p1-34-lint-gates.spec.ts against lint-fixtures/p1-34/ (README there lists the virtual paths), and
 * counted for the gate by scripts/phase-evidence.mjs (`static-checks.json`). Every message starts with its backlog id
 * (`P1-34:`, `P1-21:`, `P1-25:`, `P1-15:`) so the spec and the counters can count them.
 *
 * They apply to every linted file except the tooling set (`tests/**`, `scripts/**`, root tool configs: ADR-0005 D4
 * excepts tests and scripts, whose local-harness helpers need a privileged client, console output and env reads).
 * An allowance is granted per file set in BOUNDARY_SYNTAX_ZONES / BOUNDARY_IMPORT_ZONES below; each zone receives the
 * whole base list minus only its own allowance (flat-config option lists replace, never merge). Adding a path to the
 * system-factory allow-list or the exception register needs an ADR-0005 amendment accepted at a gate.
 */
const P134 = "P1-34:";
const SYSTEM_TAIL = String.raw`system(?:\/index)?(?:\.[cm]?[jt]sx?)?\/?$`;
// A module specifier that is an alias (`@/`), relative (`./`, `../`) or absolute (`/`) path, never a package name.
const LOCAL_SPEC = String.raw`^(?:@|\.{1,2}|)\/`;
// Any local module named `system`: the factory, a `features/<domain>/system` module, or a non-canonical spelling of one.
const ANY_SYSTEM_MODULE = String.raw`${LOCAL_SPEC}(?:.*\/)?${SYSTEM_TAIL}`;
const JOBS_INTERNAL_MODULE = String.raw`(?:${LOCAL_SPEC}(?:.*\/)?jobs\/internal(?:\/.*)?$|^\.{1,2}\/(?:\.\.\/)*internal(?:\/.*)?$)`;
const SUPABASE_CLIENT_PACKAGES = String.raw`^@supabase\/(?:supabase-js|ssr)(?:\/.*)?$`;
const SYSTEM_ALLOWED_WHERE =
  "lib/jobs/**, features/<domain>/system.ts, app/api/{jobs,webhooks}/** and the ADR-0005 exception register";

/** `no-restricted-syntax` boundary groups, keyed so a zone can name the groups it is allowed. */
const BOUNDARY_SYNTAX = {
  // ADR-0005 D4: the service-role key name only in the factory and the env modules.
  secretKey: [
    {
      selector: [
        "Identifier[name=/^SUPABASE_(SECRET|SERVICE_ROLE)_KEY$/]",
        "Literal[value=/SUPABASE_(SECRET|SERVICE_ROLE)_KEY/]",
        "TemplateElement[value.raw=/SUPABASE_(SECRET|SERVICE_ROLE)_KEY/]",
      ].join(", "),
      message: `${P134} the service-role key is read only by lib/supabase/system.ts (getSystemDb) and the env modules (ADR-0005 D4).`,
    },
  ],
  // ADR-0005 D4: no dynamic import()/require() of the factory, a system module, a jobs internal or a Supabase client
  // package; and no computed import() specifier, which no rule could check.
  dynamicImports: [
    {
      selector: [
        `ImportExpression[source.value=/${ANY_SYSTEM_MODULE}/]`,
        `ImportExpression[source.value=/${JOBS_INTERNAL_MODULE}/]`,
        `ImportExpression[source.value=/${SUPABASE_CLIENT_PACKAGES}/]`,
        `CallExpression[callee.name="require"][arguments.0.value=/${ANY_SYSTEM_MODULE}/]`,
        `CallExpression[callee.name="require"][arguments.0.value=/${JOBS_INTERNAL_MODULE}/]`,
        `CallExpression[callee.name="require"][arguments.0.value=/${SUPABASE_CLIENT_PACKAGES}/]`,
        `TSExternalModuleReference[expression.value=/${ANY_SYSTEM_MODULE}/]`,
        `TSExternalModuleReference[expression.value=/${JOBS_INTERNAL_MODULE}/]`,
        `TSExternalModuleReference[expression.value=/${SUPABASE_CLIENT_PACKAGES}/]`,
      ].join(", "),
      message: `${P134} dynamic import()/require() of the service-role factory, a system module, a jobs internal or a Supabase client package is banned everywhere; use a static import from an allowed path (ADR-0005 D4).`,
    },
    {
      selector: 'ImportExpression:not([source.type="Literal"])',
      message: `${P134} import() needs a string-literal specifier so the boundary rules can check it (ADR-0005 D4).`,
    },
  ],
  // P1-15 / 03-01: configuration is read through the typed env modules.
  processEnv: [
    {
      selector: [
        'MemberExpression[object.name="process"][property.name="env"]',
        'MemberExpression[object.name="process"][property.value="env"]',
        'MemberExpression[object.property.name="process"][property.name="env"]',
        'VariableDeclarator[init.name="process"] > ObjectPattern > Property[key.name="env"]',
      ].join(", "),
      message:
        "P1-15: read configuration through serverEnv() (lib/env-server.ts) or publicEnv (lib/env.ts); process.env is confined to the env modules, next.config.ts, instrumentation.ts and lib/log/client.ts (03-01).",
    },
  ],
  // P1-25 / 03-09c: the typed logger replaces console.*.
  console: [
    {
      selector: [
        'MemberExpression[object.name="console"]',
        'MemberExpression[object.property.name="console"]',
        'VariableDeclarator[init.name="console"]',
      ].join(", "),
      message:
        "P1-25: log through the typed logger (log from @/lib/log on the server, reportClientError from @/lib/log/client in client code); console is confined to lib/log/client.ts.",
    },
  ],
  // P1-25 / 03-09c handoff: the server logger (and the module that uses it) must not enter client bundles.
  clientLog: [
    {
      selector: `Program:has(> ExpressionStatement[directive="use client"]) ImportDeclaration[source.value=/^@\\/lib\\/(log(\\/index|\\/request-id)?|errors\\/client-message)$/]`,
      message:
        "P1-25: \"use client\" code reports errors through reportClientError (@/lib/log/client); @/lib/log, @/lib/log/request-id and @/lib/errors/client-message are server-only.",
    },
  ],
  // P1-21 / 03-05: clinic dates come from lib/datetime, never from a UTC timestamp's text or a fixed offset.
  utcDate: [
    {
      selector: [
        'CallExpression[callee.property.name=/^(split|slice|substring|substr)$/][callee.object.callee.property.name=/^(toISOString|toJSON)$/]',
        'CallExpression[callee.property.name="split"][arguments.0.value="T"]',
        "Literal[value=/T00:00:00|T23:59:59|\\+05:30/]",
        "TemplateElement[value.raw=/T00:00:00|T23:59:59|\\+05:30/]",
      ].join(", "),
      message:
        "P1-21: a UTC \"today\"/day-window pattern (toISOString() cut, .split(\"T\"), T00:00:00 / T23:59:59 / +05:30 literal); use lib/datetime (todayInTz, ymdOf, dayWindowUtc, weekdayOfYmd).",
    },
  ],
};
const boundarySyntax = (allow = []) =>
  Object.entries(BOUNDARY_SYNTAX)
    .filter(([group]) => !allow.includes(group))
    .flatMap(([, gates]) => gates);
const appSyntax = (allow = []) => ["error", ...BASE_RESTRICTED_SYNTAX, ...boundarySyntax(allow)];

/**
 * `@typescript-eslint/no-restricted-imports` boundary groups (static `import` / `export … from` / `import x =
 * require()`; the dynamic forms are BOUNDARY_SYNTAX.dynamicImports). Regex patterns are case-insensitive.
 */
const BOUNDARY_IMPORT_PATTERNS = {
  factory: {
    regex: String.raw`^@\/lib\/supabase\/${SYSTEM_TAIL}`,
    message: `${P134} the service-role factory (@/lib/supabase/system) is importable only from ${SYSTEM_ALLOWED_WHERE} (ADR-0005 D2/D4).`,
  },
  featureSystem: {
    regex: String.raw`^@\/features\/[^/]+\/${SYSTEM_TAIL}`,
    message: `${P134} a features/<domain>/system module runs on the service role and is importable only from ${SYSTEM_ALLOWED_WHERE}; features/sharing/system also from the five ADR-0005 A1 share routes.`,
  },
  // Relative, absolute or traversing spellings of a system module (`./system`, `../../lib/supabase/system`, …).
  otherSystem: {
    regex: String.raw`^(?!@\/lib\/supabase\/${SYSTEM_TAIL})(?!@\/features\/[^/]+\/${SYSTEM_TAIL})${ANY_SYSTEM_MODULE}`,
    message: `${P134} import a system module only by its canonical alias (@/lib/supabase/system, @/features/<domain>/system) and only from ${SYSTEM_ALLOWED_WHERE} (ADR-0005 D4).`,
  },
  jobsInternal: {
    regex: JOBS_INTERNAL_MODULE,
    message: `${P134} lib/jobs/internal (claim, handlers, runner) is importable only from app/api/jobs/** and lib/jobs/internal/**; request paths use the lib/jobs enqueue surface (ADR-0005 D2).`,
  },
};
const BOUNDARY_IMPORT_PATHS = {
  createClient: {
    name: "@supabase/supabase-js",
    importNames: ["createClient"],
    allowTypeImports: true,
    message: `${P134} a createClient value import makes a second Supabase client factory; the only one is lib/supabase/system.ts (getSystemDb). Type imports are allowed (ADR-0005 D2/D4).`,
  },
  ssrClients: {
    name: "@supabase/ssr",
    importNames: ["createServerClient", "createBrowserClient"],
    allowTypeImports: true,
    message: `${P134} the cookie-session clients are created only in lib/supabase/server.ts, lib/supabase/client.ts and proxy.ts (ADR-0005 D4).`,
  },
};
// ADR-0005 A1: features/sharing/system from the five public share routes, and no other features/*/system.
const A1_SHARING_ONLY = {
  regex: String.raw`^@\/features\/(?!sharing\/${SYSTEM_TAIL})[^/]+\/${SYSTEM_TAIL}`,
  message: `${P134} the ADR-0005 A1 share routes may import features/sharing/system only.`,
};
const appImports = (allow = [], extraPatterns = []) => [
  "error",
  {
    paths: Object.entries(BOUNDARY_IMPORT_PATHS)
      .filter(([group]) => !allow.includes(group))
      .map(([, path]) => path),
    patterns: [
      ...Object.entries(BOUNDARY_IMPORT_PATTERNS)
        .filter(([group]) => !allow.includes(group))
        .map(([, pattern]) => pattern),
      ...extraPatterns,
    ],
  },
];

const SYSTEM_MODULES = ["factory", "featureSystem", "otherSystem"];

/** Syntax allowances. Zones are disjoint from each other and from the schema/route zones in the config below. */
const BOUNDARY_SYNTAX_ZONES = [
  { files: ["lib/supabase/system.ts"], allow: ["secretKey"] },
  { files: ["lib/env.ts", "lib/env-server.ts"], allow: ["secretKey", "processEnv"] },
  { files: ["next.config.ts", "instrumentation.ts"], allow: ["processEnv"] },
  // 03-09a: the dev-only client reporter reads NODE_ENV and writes one console.warn (03-09c census: the only site).
  { files: ["lib/log/client.ts"], allow: ["processEnv", "console"] },
  { files: ["lib/datetime/**"], allow: ["utcDate"] },
];

/** Import allowances, in order: a later zone overrides an earlier one for the files both match. */
const BOUNDARY_IMPORT_ZONES = [
  { files: ["lib/supabase/system.ts"], allow: ["createClient"] },
  { files: ["lib/supabase/server.ts", "lib/supabase/client.ts", "proxy.ts"], allow: ["ssrClients"] },
  // ADR-0005 D2 allow-list.
  { files: ["lib/jobs/**", "features/*/system.ts", "app/api/webhooks/**"], allow: SYSTEM_MODULES },
  // ADR-0005 exception register. Owner P1-37 (public API rework): delete when /api/v1 stops using the service role.
  { files: ["app/api/v1/**", "lib/api/**"], allow: SYSTEM_MODULES },
  // ADR-0005 exception register. Owner V2-04 (enqueue RPC + app/api/jobs/run replace these): delete in V2-04 04-03c.
  { files: ["app/api/cron/**", "lib/messaging/dispatcher.ts", "lib/webhooks/**"], allow: SYSTEM_MODULES },
  // ADR-0005 A1: the five public share routes (minimatch escapes the brackets of the dynamic segment).
  {
    files: [
      "app/api/r/\\[token\\]/route.ts",
      "app/r/\\[token\\]/page.tsx",
      "app/api/reports/view/route.ts",
      "app/reports/view/page.tsx",
      "app/api/reschedule/\\[token\\]/route.ts",
    ],
    allow: ["featureSystem"],
    extraPatterns: [A1_SHARING_ONLY],
  },
  // ADR-0005 D2: the jobs runner route and the jobs internals (after lib/jobs/** so the internals get the superset).
  { files: ["lib/jobs/internal/**", "app/api/jobs/**"], allow: [...SYSTEM_MODULES, "jobsInternal"] },
];

// ADR-0005 D4: tests and scripts are excepted from the boundary gates; so are the root tool configs.
const TOOLING_FILES = [
  "tests/**",
  "scripts/**",
  "eslint.config.mjs",
  "playwright.config.ts",
  "vitest.config.ts",
  "postcss.config.mjs",
];

const eslintConfig = [
  {
    ignores: [
      // Generated or tool-owned (git-ignored): Next build output and the project-local GSD install.
      ".next/**",
      ".claude/**",
      "next-env.d.ts",
      // Lint-gate fixtures violate the rules on purpose; tests/security/*-lint-gates.spec.ts lint them explicitly.
      "lint-fixtures/**",
      // V2-02 02-01: tooling and report output, and docs (no app code; docs/temp is a vendored third-party template).
      "docs/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "blob-report/**",
      "playwright/.auth/**",
      ".agents/**",
      ".opencode/**",
      ".gsd/**",
      "supabase/.temp/**",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "no-restricted-syntax": appSyntax(),
      "@typescript-eslint/no-restricted-imports": appImports(),
    },
  },
  {
    // Same file set as eslint-config-next's `next` object, which is where the react-hooks plugin is registered.
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    rules: {
      // eslint-plugin-react-hooks 7 (pulled in by eslint-config-next 16, V2-03 03-06) adds React Compiler rules whose
      // recommended level is "error". They flag 35 pre-existing v1 sites (set-state-in-effect 30, purity 4,
      // immutability 1); the client components are rebuilt on the V2-06 frontend foundation (P1-28), which owns
      // raising these back to "error". Recorded in .planning/phases/03-platform-hygiene/03-06-NEXT16.md.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
    },
  },
  {
    files: ["features/**/schema.ts"],
    rules: {
      "no-restricted-syntax": [...appSyntax(), ...P001_SCHEMA_GATES],
    },
  },
  {
    files: ["app/**/route.js", "app/**/route.jsx", "app/**/route.tsx", "app/**/route.mjs", "app/**/route.cjs"],
    rules: {
      "no-restricted-syntax": [...appSyntax(), ...P013_ROUTE_FILE_GATES],
    },
  },
  ...BOUNDARY_SYNTAX_ZONES.map(({ files, allow }) => ({
    files,
    rules: { "no-restricted-syntax": appSyntax(allow) },
  })),
  ...BOUNDARY_IMPORT_ZONES.map(({ files, allow, extraPatterns }) => ({
    files,
    rules: { "@typescript-eslint/no-restricted-imports": appImports(allow, extraPatterns) },
  })),
  {
    // Last, so it wins over every zone above: tooling keeps the AUTH-01 / P0-01 / P0-13 gates only.
    files: TOOLING_FILES,
    rules: {
      "no-restricted-syntax": ["error", ...BASE_RESTRICTED_SYNTAX],
      "@typescript-eslint/no-restricted-imports": "off",
    },
  },
];

/**
 * Census inputs for scripts/phase-evidence.mjs (`static-checks.json`): the same createClient restriction and system-module
 * patterns as the gates above, applied to every app-code file through `overrideConfig` so ESLint itself lists the
 * service-role factory (expected `lib/supabase/system.ts` only) and every importer of a system module.
 */
export const P134_CENSUS = {
  factoryPath: BOUNDARY_IMPORT_PATHS.createClient,
  systemPatterns: {
    factory: BOUNDARY_IMPORT_PATTERNS.factory.regex,
    featureSystem: BOUNDARY_IMPORT_PATTERNS.featureSystem.regex,
    otherSystem: BOUNDARY_IMPORT_PATTERNS.otherSystem.regex,
  },
};

export default eslintConfig;
