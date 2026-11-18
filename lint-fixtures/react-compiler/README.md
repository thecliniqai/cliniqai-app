# React Compiler rule fixtures (V2-06 06-08, R-30)

Used by `tests/ci/react-compiler-waivers.spec.ts`, which lints them at virtual app paths. Each file breaks one rule on
purpose; ESLint ignores `lint-fixtures/**`.

- `set-state-in-effect.tsx`, `purity.tsx`, `immutability.tsx`: one finding each, at `error` outside a waived file.
- `inline-directive.tsx`: an `eslint-disable-next-line` naming a compiler rule (`clinicos/no-compiler-rule-directive`).
