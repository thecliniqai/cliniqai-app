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
// V2-04 04-03a (P0-12, R-33): no request path sends a patient message; only the job runner does.
const P012 = "P0-12:";
const MESSAGING_SEND_NAMES = [
  "getMessagingProvider",
  "sendDirectSms",
  "sendDirectWhatsApp",
  "Msg91Provider",
  "TwilioProvider",
  "GupshupProvider",
  "DevLoggerProvider",
  "DisabledMessagingProvider",
  "SinkProvider",
];
const MESSAGING_SEND_WHERE =
  "lib/jobs/internal/** (the message.send and message.reply_unmatched handlers) and lib/messaging/**";
// The provider modules themselves, by alias or by any relative spelling (`../messaging/providers/msg91`).
const MESSAGING_PROVIDER_MODULE = String.raw`^(?:@\/lib\/|(?:\.{1,2}\/)+(?:.*\/)?)messaging\/(?:providers(?:\/.*)?|dev-logger)$|^(?:\.{1,2}\/)+(?:providers(?:\/.*)?|dev-logger)$`;
// V2-04 04-03b (P0-12, R-33): the webhook deliverer and its pinned transport, by alias or by any relative spelling
// (`../webhooks/dispatcher`, `./transport`, with or without an extension or `/index`).
const WEBHOOK_DELIVER_MODULE = String.raw`^(?:@\/lib\/|(?:\.{1,2}\/)+(?:.*\/)?)webhooks\/(?:dispatcher|transport)(?:\/index)?(?:\.[cm]?[jt]sx?)?$|^(?:\.{1,2}\/)+(?:dispatcher|transport)(?:\/index)?(?:\.[cm]?[jt]sx?)?$`;
const WEBHOOK_DELIVER_WHERE = "lib/jobs/internal/** (the webhook.deliver handler) and lib/webhooks/**";
// The messaging barrel by any spelling (`@/lib/messaging`, `@/lib/messaging/index`, `../../lib/messaging`).
const MESSAGING_BARREL = String.raw`^(?:@\/lib\/|(?:\.{1,2}\/)+(?:.*\/)?)messaging(?:\/index)?$`;
const SYSTEM_TAIL = String.raw`system(?:\/index)?(?:\.[cm]?[jt]sx?)?\/?$`;
// A module specifier that is an alias (`@/`), relative (`./`, `../`) or absolute (`/`) path, never a package name.
const LOCAL_SPEC = String.raw`^(?:@|\.{1,2}|)\/`;
// Any local module named `system`: the factory, a `features/<domain>/system` module, or a non-canonical spelling of one.
const ANY_SYSTEM_MODULE = String.raw`${LOCAL_SPEC}(?:.*\/)?${SYSTEM_TAIL}`;
const JOBS_INTERNAL_MODULE = String.raw`(?:${LOCAL_SPEC}(?:.*\/)?jobs\/internal(?:\/.*)?$|^\.{1,2}\/(?:\.\.\/)*internal(?:\/.*)?$)`;
// 03-13c (M-LINT): every Supabase package, any subpath (supabase-js, ssr, postgrest-js, auth-js, storage-js, …).
const SUPABASE_CLIENT_PACKAGES = String.raw`^@supabase\/`;
const SYSTEM_ALLOWED_WHERE =
  "lib/jobs/internal/**, features/<domain>/system.ts, app/api/{jobs,webhooks}/** and the ADR-0005 exception register";
// 03-13c (M-ALLOWLIST): the tooling and document trees are never imported by app code (a factory wrapper there would
// launder the service role past every zone); alias, relative or traversing spellings.
const TOOLING_TREE_MODULE = String.raw`^(?:@\/|(?:\.\.?\/)+)(?:scripts|tests|docs|lint-fixtures|\.planning)(?:\/|$)`;
// 03-13c (M-LINT): the eslint rules that carry the boundary gates; an inline directive may not name or blanket them.
const BOUNDARY_RULE_IDS = ["@typescript-eslint/no-restricted-imports", "no-restricted-imports", "no-restricted-syntax"];

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
    {
      // 03-13c (M-LINT, review B M-3 / IND L-3): a secret-key name built from pieces, or a computed read of the env.
      selector: [
        "Literal[value=/^(SUPABASE|SUPABASE_|SECRET|SECRET_|_SECRET|SECRET_KEY|_SECRET_KEY|SERVICE_ROLE|SERVICE_ROLE_|_SERVICE_ROLE|SERVICE_ROLE_KEY|_SERVICE_ROLE_KEY|_KEY|KEY)$/]",
        "TemplateElement[value.raw=/(^|[^A-Z_])(SECRET|SERVICE_ROLE)(_KEY)?($|[^A-Z_])/]",
        'MemberExpression[computed=true][object.type="CallExpression"][object.callee.name="serverEnv"]',
        'MemberExpression[computed=true][property.type!="Literal"][object.name=/env$/i]',
        'VariableDeclarator[init.callee.name="serverEnv"] > ObjectPattern > Property[computed=true]',
        'VariableDeclarator[init.callee.name="serverEnv"] > ObjectPattern > RestElement',
        'SpreadElement > CallExpression[callee.name="serverEnv"]',
        'CallExpression[callee.object.name=/^(Object|Reflect|JSON)$/] > CallExpression.arguments[callee.name="serverEnv"]',
      ].join(", "),
      message: `${P134} read the env through named properties (serverEnv().NAME); a computed, spread or enumerated read, or a secret-key name built from pieces, could reach the service-role key (ADR-0005 D4).`,
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
        `ImportExpression[source.value=/${TOOLING_TREE_MODULE}/]`,
        `CallExpression[callee.name="require"][arguments.0.value=/${TOOLING_TREE_MODULE}/]`,
      ].join(", "),
      message: `${P134} dynamic import()/require() of the service-role factory, a system module, a jobs internal or a Supabase client package is banned everywhere; use a static import from an allowed path (ADR-0005 D4).`,
    },
    {
      // 03-13c (M-LINT, review B M-3): every other way to load a module at run time, which no rule could check.
      selector: [
        'CallExpression[callee.name="require"]:not([arguments.0.type="Literal"])',
        'Identifier[name="require"]:not(CallExpression > Identifier.callee):not(Property > Identifier.key)',
        'MemberExpression[property.name="require"]',
        'MemberExpression[property.value="require"]',
        "Identifier[name=/^(createRequire|__non_webpack_require__|__webpack_require__)$/]",
      ].join(", "),
      message: `${P134} require() needs a string-literal specifier and may not be aliased, reached as module.require or built with createRequire, so the boundary rules can check it (ADR-0005 D4).`,
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
  // P1-25 / 03-13 (High re-verify, Low): a raw process.stdout / process.stderr write bypasses both the typed logger and
  // the console scrubber (lib/observability/console-scrub.ts cannot wrap the streams without breaking the logger).
  // Any reach of the two streams (member, computed, destructured, through globalThis or imported from node:process) is
  // confined to lib/log/** and lib/observability/**.
  rawStream: [
    {
      selector: [
        'MemberExpression[object.name="process"][property.name=/^(stdout|stderr)$/]',
        'MemberExpression[object.name="process"][property.value=/^(stdout|stderr)$/]',
        'MemberExpression[object.property.name="process"][property.name=/^(stdout|stderr)$/]',
        'VariableDeclarator[init.name="process"] > ObjectPattern > Property[key.name=/^(stdout|stderr)$/]',
        'ImportDeclaration[source.value=/^(node:)?process$/] > ImportSpecifier[imported.name=/^(stdout|stderr)$/]',
        'MemberExpression[object.callee.name="require"][object.arguments.0.value=/^(node:)?process$/][property.name=/^(stdout|stderr)$/]',
      ].join(", "),
      message:
        "P1-25: write output through the typed logger (log from @/lib/log); process.stdout / process.stderr are confined to lib/log/** and lib/observability/**, where output is scrubbed.",
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
  // 03-13c (M-LINT): a VALUE import from any Supabase package or subpath makes or reaches a client (createClient,
  // new SupabaseClient, GoTrueAdminApi, PostgrestClient, @supabase/ssr/dist/…). Only the factory and the three
  // cookie-session modules may; each of them is narrowed to its own names below. Type imports are allowed.
  supabaseValue: {
    regex: SUPABASE_CLIENT_PACKAGES,
    allowTypeImports: true,
    message: `${P134} a value import from a Supabase package (any package or subpath) creates a second client factory; the only ones are lib/supabase/system.ts (getSystemDb) and the cookie-session modules lib/supabase/{server,client}.ts and proxy.ts. Type imports are allowed (ADR-0005 D2/D4).`,
  },
  // 03-13c (M-ALLOWLIST): app code never imports scripts/, tests/, docs/, lint-fixtures/ or .planning/.
  toolingTree: {
    regex: TOOLING_TREE_MODULE,
    message: `${P134} app code may not import scripts/, tests/, docs/, lint-fixtures/ or .planning/: a helper there is outside every boundary zone (ADR-0005 D4).`,
  },
  factory: {
    regex: String.raw`^@\/lib\/supabase\/${SYSTEM_TAIL}`,
    message: `${P134} the service-role factory (@/lib/supabase/system) is importable only from ${SYSTEM_ALLOWED_WHERE} (ADR-0005 D2/D4).`,
  },
  featureSystem: {
    regex: String.raw`^@\/features\/[^/]+\/${SYSTEM_TAIL}`,
    message: `${P134} a features/<domain>/system module runs on the service role and is importable only from ${SYSTEM_ALLOWED_WHERE}; features/sharing/system also from the five ADR-0005 A1 share routes, features/auth/system also from the Send Email hook route (proposed A3).`,
  },
  // Relative, absolute or traversing spellings of a system module (`./system`, `../../lib/supabase/system`, …).
  otherSystem: {
    regex: String.raw`^(?!@\/lib\/supabase\/${SYSTEM_TAIL})(?!@\/features\/[^/]+\/${SYSTEM_TAIL})${ANY_SYSTEM_MODULE}`,
    message: `${P134} import a system module only by its canonical alias (@/lib/supabase/system, @/features/<domain>/system) and only from ${SYSTEM_ALLOWED_WHERE} (ADR-0005 D4).`,
  },
  // V2-04 04-03a (P0-12, R-33): the provider factory, the direct senders and the provider classes, from the barrel or
  // the provider modules, only in lib/jobs/internal/** and lib/messaging/** (04-03c deleted the inbound route's allowance;
  // sendDirectSms/sendDirectWhatsApp are deleted and stay banned by name).
  messagingSend: [
    {
      regex: MESSAGING_BARREL,
      importNames: MESSAGING_SEND_NAMES,
      allowTypeImports: true,
      message: `${P012} a request path never sends a message; enqueue through @/lib/jobs/enqueue. The provider factory and the direct senders are importable only from ${MESSAGING_SEND_WHERE} (R-33).`,
    },
    {
      regex: MESSAGING_PROVIDER_MODULE,
      allowTypeImports: true,
      message: `${P012} a request path never sends a message; enqueue through @/lib/jobs/enqueue. The messaging provider modules are importable only from ${MESSAGING_SEND_WHERE} (R-33).`,
    },
  ],
  // V2-04 04-03b (P0-12, R-33): no request path delivers a webhook (the 03-10 fire-and-forget dispatch is gone).
  webhookDeliver: {
    regex: WEBHOOK_DELIVER_MODULE,
    allowTypeImports: true,
    message: `${P012} a request path never delivers a webhook; enqueue through @/lib/jobs/enqueue (enqueueWebhookEvent). The webhook deliverer and its pinned transport are importable only from ${WEBHOOK_DELIVER_WHERE} (R-33).`,
  },
  jobsInternal: {
    regex: JOBS_INTERNAL_MODULE,
    message: `${P134} lib/jobs/internal (claim, handlers, runner) is importable only from app/api/jobs/** and lib/jobs/internal/**; request paths use the lib/jobs enqueue surface (ADR-0005 D2).`,
  },
};
/** The narrowed Supabase allowance of the factory and of the cookie-session modules (zones below). */
const SUPABASE_FACTORY_ONLY = {
  paths: [
    {
      name: "@supabase/supabase-js",
      allowImportNames: ["createClient"],
      allowTypeImports: true,
      message: `${P134} the factory imports createClient only from @supabase/supabase-js (ADR-0005 D2/D4).`,
    },
  ],
  patterns: [
    {
      regex: String.raw`^@supabase\/(?!supabase-js$)`,
      allowTypeImports: true,
      message: `${P134} the factory imports createClient from the bare @supabase/supabase-js only (ADR-0005 D2/D4).`,
    },
  ],
};
const SUPABASE_SSR_ONLY = {
  paths: [
    {
      name: "@supabase/ssr",
      allowImportNames: ["createServerClient", "createBrowserClient"],
      allowTypeImports: true,
      message: `${P134} the cookie-session modules import createServerClient / createBrowserClient only (ADR-0005 D4).`,
    },
  ],
  patterns: [
    {
      regex: String.raw`^@supabase\/(?!ssr$)`,
      allowTypeImports: true,
      message: `${P134} the cookie-session modules import from the bare @supabase/ssr only (ADR-0005 D4).`,
    },
  ],
};
// ADR-0005 A1: features/sharing/system from the five public share routes, and no other features/*/system.
const A1_SHARING_ONLY = {
  regex: String.raw`^@\/features\/(?!sharing\/${SYSTEM_TAIL})[^/]+\/${SYSTEM_TAIL}`,
  message: `${P134} the ADR-0005 A1 share routes may import features/sharing/system only.`,
};
// Proposed ADR-0005 A3 (V2-04 04-03c, R-43): the Send Email hook route may import features/auth/system, and no other
// features/*/system (nor the factory itself).
const A3_AUTH_ONLY = {
  regex: String.raw`^@\/features\/(?!auth\/${SYSTEM_TAIL})[^/]+\/${SYSTEM_TAIL}`,
  message: `${P134} the Send Email hook route (proposed ADR-0005 A3) may import features/auth/system only.`,
};
const appImports = (allow = [], extraPatterns = [], extraPaths = []) => [
  "error",
  {
    paths: extraPaths,
    patterns: [
      ...Object.entries(BOUNDARY_IMPORT_PATTERNS)
        .filter(([group]) => !allow.includes(group))
        .flatMap(([, pattern]) => [pattern].flat()),
      ...extraPatterns,
    ],
  },
];

const SYSTEM_MODULES = ["factory", "featureSystem", "otherSystem"];

/**
 * The ADR-0005 exception register: paths outside the D2 allow-list that may still acquire the system client, each with
 * an owner. V2-04 04-03c deleted the V2-04 entries (`app/api/cron/**`, `lib/messaging/dispatcher.ts`, `lib/webhooks/**`)
 * with their passing cases; what is left is the /api/v1 entry (owner P1-37, public API rework). Exported through
 * P134_CENSUS so the counters (scripts/ci/p1-34-counters.mjs) report the register as configured.
 */
const ADR0005_REGISTER = ["app/api/v1/**", "lib/api/**"];

/**
 * Syntax allowances. Zones are disjoint from each other (except lib/log/client.ts inside lib/log/**, ordered so the
 * narrower zone wins and repeats the wider allowance) and from the schema/route zones in the config below.
 */
const BOUNDARY_SYNTAX_ZONES = [
  { files: ["lib/supabase/system.ts"], allow: ["secretKey"] },
  { files: ["lib/env.ts", "lib/env-server.ts"], allow: ["secretKey", "processEnv"] },
  { files: ["next.config.ts", "instrumentation.ts"], allow: ["processEnv"] },
  // 03-13 (High re-verify, Low): the typed logger and the scrubber own the raw output streams. Listed before
  // lib/log/client.ts, which overlaps it and so repeats the allowance (a later zone replaces the option list).
  { files: ["lib/log/**", "lib/observability/**"], allow: ["rawStream"] },
  // 03-09a: the dev-only client reporter reads NODE_ENV and writes one console.warn (03-09c census: the only site).
  { files: ["lib/log/client.ts"], allow: ["processEnv", "console", "rawStream"] },
  { files: ["lib/datetime/**"], allow: ["utcDate"] },
];

/** Import allowances, in order: a later zone overrides an earlier one for the files both match. */
const BOUNDARY_IMPORT_ZONES = [
  {
    files: ["lib/supabase/system.ts"],
    allow: ["supabaseValue"],
    extraPatterns: SUPABASE_FACTORY_ONLY.patterns,
    extraPaths: SUPABASE_FACTORY_ONLY.paths,
  },
  {
    files: ["lib/supabase/server.ts", "lib/supabase/client.ts", "proxy.ts"],
    allow: ["supabaseValue"],
    extraPatterns: SUPABASE_SSR_ONLY.patterns,
    extraPaths: SUPABASE_SSR_ONLY.paths,
  },
  // ADR-0005 D2 allow-list. lib/jobs: only the internals (zone at the end), never the enqueue surface that request
  // paths import (03-13c M-ALLOWLIST).
  { files: ["features/*/system.ts", "app/api/webhooks/**"], allow: SYSTEM_MODULES },
  // ADR-0005 exception register. Owner P1-37 (public API rework): delete when /api/v1 stops using the service role.
  { files: ADR0005_REGISTER, allow: SYSTEM_MODULES },
  // V2-04 04-03a (P0-12): the messaging modules themselves (the barrel re-exports the providers it builds).
  { files: ["lib/messaging/**"], allow: ["messagingSend"] },
  // V2-04 04-03b (P0-12): the webhook modules themselves (the deliverer imports the pinned transport). Not a system
  // path: 04-03c removed lib/webhooks/** from the register (no module there acquires the system client).
  { files: ["lib/webhooks/**"], allow: ["webhookDeliver"] },
  // Proposed ADR-0005 A3 (V2-04 04-03c, R-43): the Send Email hook route records the signed webhook-id through
  // features/auth/system after its signature check; features/auth/system only (not the factory, not another domain).
  {
    files: ["app/api/auth/send-email/route.ts"],
    allow: ["featureSystem"],
    extraPatterns: [A3_AUTH_ONLY],
  },
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
  // P0-12 (R-33): only the internals (the message.send / webhook.deliver handlers) build a provider or deliver a
  // webhook; the runner route does not.
  { files: ["lib/jobs/internal/**"], allow: [...SYSTEM_MODULES, "jobsInternal", "messagingSend", "webhookDeliver"] },
];

// ADR-0005 D4: tests and scripts are excepted from the boundary gates; so are the root tool configs. V2-04 04-05a:
// `ops/**` (backup, restore drill and backup evidence: operator tooling run with tsx/bash, never imported by the app)
// joins with the same exceptions as `scripts/**`.
const TOOLING_FILES = [
  "tests/**",
  "scripts/**",
  "ops/**",
  "eslint.config.mjs",
  "playwright.config.ts",
  "vitest.config.ts",
  "postcss.config.mjs",
];

/**
 * 03-13c (M-LINT, review B M-3): an inline directive cannot switch a boundary gate off. Reports any `eslint-disable*`
 * comment that names a boundary rule or names no rule at all (a blanket disable), and any `/* eslint … *\/` rule
 * configuration comment for a boundary rule, in app code. The census (scripts/ci/p1-34-counters.mjs) and
 * tests/security/p1-34-lint-gates.spec.ts additionally lint with inline configuration off, so a gate silenced by a
 * directive this rule cannot see still counts.
 */
const BOUNDARY_DIRECTIVE = /^\s*(eslint-disable(?:-next-line|-line)?|eslint-enable|eslint)(?:\s+([\s\S]*?))?(?:\s+--[\s\S]*)?\s*$/;
const boundaryDirectivePlugin = {
  rules: {
    "no-boundary-directive": {
      meta: { type: "problem", schema: [], docs: { description: "No inline directive may disable a P1-34 boundary gate." } },
      create(context) {
        return {
          Program() {
            for (const comment of context.sourceCode.getAllComments()) {
              const match = BOUNDARY_DIRECTIVE.exec(comment.value);
              if (!match) continue;
              const [, kind, rest = ""] = match;
              if (kind === "eslint-enable") continue;
              if (kind === "eslint" && comment.type !== "Block") continue;
              const names = kind === "eslint"
                ? [...rest.matchAll(/([@\w/-]+)\s*:/g)].map((m) => m[1])
                : rest.split(",").map((n) => n.trim()).filter(Boolean);
              const blanket = kind !== "eslint" && names.length === 0;
              const boundary = names.some((n) => BOUNDARY_RULE_IDS.includes(n) || n === "clinicos/no-boundary-directive");
              if (blanket || boundary) {
                context.report({
                  loc: comment.loc,
                  message: `${P134} an inline eslint directive may not disable or reconfigure the boundary gates (${BOUNDARY_RULE_IDS.join(", ")}) or blanket-disable all rules in app code; fix the code or amend ADR-0005.`,
                });
              }
            }
          },
        };
      },
    },
  },
};

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
    plugins: { clinicos: boundaryDirectivePlugin },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "no-restricted-syntax": appSyntax(),
      "@typescript-eslint/no-restricted-imports": appImports(),
      "clinicos/no-boundary-directive": "error",
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
  ...BOUNDARY_IMPORT_ZONES.map(({ files, allow, extraPatterns, extraPaths }) => ({
    files,
    rules: { "@typescript-eslint/no-restricted-imports": appImports(allow, extraPatterns, extraPaths) },
  })),
  {
    // Last, so it wins over every zone above: tooling keeps the AUTH-01 / P0-01 / P0-13 gates only.
    files: TOOLING_FILES,
    rules: {
      "no-restricted-syntax": ["error", ...BASE_RESTRICTED_SYNTAX],
      "@typescript-eslint/no-restricted-imports": "off",
      "clinicos/no-boundary-directive": "off",
    },
  },
];

/**
 * Census inputs for scripts/phase-evidence.mjs (`static-checks.json`): a Supabase value-import restriction and the
 * system-module patterns of the gates above, applied to every app-code file through `overrideConfig` so ESLint itself lists the
 * service-role factory (expected `lib/supabase/system.ts` only) and every importer of a system module.
 */
export const P134_CENSUS = {
  // 03-13c: any value import from a Supabase package other than the bare @supabase/ssr (the cookie-session clients) is
  // a client factory, whatever the name (createClient, SupabaseClient, GoTrueAdminApi, PostgrestClient, a subpath).
  factoryPattern: { regex: String.raw`^@supabase\/(?!ssr$)`, allowTypeImports: true },
  boundaryRuleIds: BOUNDARY_RULE_IDS,
  // V2-04 04-03c: the exception register as configured (the zone above is built from the same list).
  exceptionRegister: ADR0005_REGISTER,
  systemPatterns: {
    factory: BOUNDARY_IMPORT_PATTERNS.factory.regex,
    featureSystem: BOUNDARY_IMPORT_PATTERNS.featureSystem.regex,
    otherSystem: BOUNDARY_IMPORT_PATTERNS.otherSystem.regex,
  },
};

export default eslintConfig;
