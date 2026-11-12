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
      "no-restricted-syntax": ["error", ...AUTH01_GATES],
    },
  },
];

export default eslintConfig;
