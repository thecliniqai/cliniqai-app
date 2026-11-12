import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

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

// Flat-config `no-restricted-syntax` options do not merge across config objects: each file set gets one combined list.
const BASE_RESTRICTED_SYNTAX = [...AUTH01_GATES, ...P001_ACTION_GATES];

const eslintConfig = [
  {
    ignores: [
      // Generated or tool-owned (git-ignored): Next build output and the project-local GSD install.
      ".next/**",
      ".claude/**",
      "next-env.d.ts",
      // Lint-gate fixtures violate the rules on purpose; tests/security/*-lint-gates.spec.ts lint them explicitly.
      "lint-fixtures/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "no-restricted-syntax": ["error", ...BASE_RESTRICTED_SYNTAX],
    },
  },
  {
    files: ["features/**/schema.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...BASE_RESTRICTED_SYNTAX, ...P001_SCHEMA_GATES],
    },
  },
];

export default eslintConfig;
