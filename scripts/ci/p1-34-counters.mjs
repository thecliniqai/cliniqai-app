/**
 * V2-03 03-04 acceptance counters (P1-34 / ADR-0005 V4, P1-21), computed by ESLint, never by grep. Used by
 * scripts/phase-evidence.mjs (`static-checks.json`) and proven by tests/security/p1-34-lint-gates.spec.ts.
 *
 * - `boundary_messages`: the real eslint.config.mjs over app code with inline configuration OFF (03-13c M-LINT: an
 *   `eslint-disable` or `/* eslint … *\/` comment cannot hide a gate from the census); count of messages per backlog
 *   id (P1-34, P1-21, P1-25, P1-15, P0-12) and the file:line of each (expected all 0, so the list is empty).
 * - `boundary_directives`: boundary messages that an inline directive suppresses when inline configuration is ON,
 *   as file:line (expected empty; the `clinicos/no-boundary-directive` rule also fails `npx eslint .` on them).
 * - `service_role_factories`: files flagged when a value-import restriction on every Supabase package (other than the
 *   bare `@supabase/ssr`) is applied to every app-code file through `overrideConfig` (expected exactly
 *   `lib/supabase/system.ts`).
 * - `system_module_importers`: files flagged when the system-module import patterns are applied to every app-code
 *   file the same way; each is inside the allow-list or the exception register when `boundary_messages` is 0.
 *
 * Reads source only: no env values, no test data.
 */
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { ESLint } from "eslint";

export const APP_CODE = [
  "app",
  "components",
  "features",
  "lib",
  "types",
  "proxy.ts",
  "instrumentation.ts",
  "next.config.ts",
];
// V2-04 04-03a: P0-12 (no request path sends a message, R-33) joins the per-backlog-id census.
const IDS = ["P1-34", "P1-21", "P1-25", "P1-15", "P0-12"];
// no-restricted-syntax messages start with the id; typescript-eslint's no-restricted-imports prepends a sentence.
const BOUNDARY_ID = /(?:^|\s)(P1-(?:34|21|25|15)|P0-12):/;
const CENSUS = "census:";

/** `targets`/`ignore` exist for the spec, which points the counters at lint-fixtures/p1-34 (ignored by default). */
export async function p134Counters({ cwd = process.cwd(), targets = APP_CODE, ignore = true } = {}) {
  const { P134_CENSUS } = await import(pathToFileURL(join(cwd, "eslint.config.mjs")).href);
  const rel = (file) => relative(cwd, file);

  const real = await new ESLint({ cwd, ignore, allowInlineConfig: false }).lintFiles(targets);
  const byId = Object.fromEntries(IDS.map((id) => [id, 0]));
  const flagged = [];
  for (const result of real) {
    for (const m of result.messages) {
      const id = BOUNDARY_ID.exec(m.message)?.[1];
      if (!id) continue;
      byId[id] += 1;
      flagged.push(`${rel(result.filePath)}:${m.line} ${id} ${m.ruleId}`);
    }
  }

  // The same lint as `npx eslint .` (inline configuration on): what a directive suppresses there.
  const directives = [];
  for (const result of await new ESLint({ cwd, ignore }).lintFiles(targets)) {
    for (const m of result.suppressedMessages ?? []) {
      if (BOUNDARY_ID.test(m.message)) directives.push(`${rel(result.filePath)}:${m.line} ${m.ruleId}`);
    }
  }

  const censusRule = {
    paths: [],
    patterns: [
      { ...P134_CENSUS.factoryPattern, message: `${CENSUS}supabaseValue` },
      ...Object.entries(P134_CENSUS.systemPatterns).map(([name, regex]) => ({
        regex,
        message: `${CENSUS}${name}`,
      })),
    ],
  };
  const census = await new ESLint({
    cwd,
    ignore,
    allowInlineConfig: false,
    overrideConfig: {
      rules: {
        "no-restricted-syntax": "off",
        "@typescript-eslint/no-restricted-imports": ["error", censusRule],
      },
    },
  }).lintFiles(targets);
  const factories = new Set();
  const importers = { factory: new Set(), featureSystem: new Set(), otherSystem: new Set() };
  for (const result of census) {
    for (const m of result.messages) {
      if (m.ruleId !== "@typescript-eslint/no-restricted-imports") continue;
      const at = m.message.indexOf(CENSUS);
      if (at === -1) continue;
      const tag = m.message.slice(at + CENSUS.length);
      if (tag === "supabaseValue") factories.add(rel(result.filePath));
      else importers[tag]?.add(rel(result.filePath));
    }
  }
  const sorted = (set) => [...set].sort();

  return {
    files_linted: real.length,
    boundary_messages: { ...byId, flagged },
    boundary_directives: directives.sort(),
    p1_34_boundary_messages: byId["P1-34"],
    utc_today_messages: byId["P1-21"],
    service_role_factories: sorted(factories),
    system_module_importers: {
      factory: sorted(importers.factory),
      feature_system: sorted(importers.featureSystem),
      non_canonical: sorted(importers.otherSystem),
    },
  };
}
