# UI policy fixtures (V2-06 06-01a)

Used by `tests/ci/ui-policy.spec.ts` and `tests/design/codemod.spec.ts`. These files break the DESIGN_SYSTEM §10 rules
on purpose; ESLint ignores `lint-fixtures/**`.

- `violations/` one finding per report-mode rule, plus code that must NOT be flagged (comments, imports, primitives).
- `brand/` a `brand-*` class (the enforced rule).
- `screen-height/` 100vh height classes (enforced since 06-04a) next to the `min-h-app`/`h-app` utilities that pass.
- `extra-rules/` a rule directory with one extra rule file: proves rules are discovered without a central list.
- `codemod/` input of the colour codemod (`scripts/design/codemod-colors.mjs`), copied to a temp dir by the test.
