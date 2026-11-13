#!/usr/bin/env bash
# V2-03 phase close: the logger event-name list (03-PLAN.md "Phase close" step 5). Reads source only.
# Walks every .ts/.tsx file in app/ components/ features/ lib/ proxy.ts instrumentation.ts with the TypeScript
# compiler API and collects string-literal event names from:
#   - an object property `event: "<name>"` (log.info/warn/error fields and helpers that pass them on), or
#     `event: NAME` where NAME is a same-file `const NAME = "<name>"`,
#   - reportClientError("<name>", …) (client reporter),
#   - clientErrorMessage(err, "<fallback>", "<name>") (third argument).
# Each name is checked against EVENT_PATTERN from lib/log/fields.ts. Output: header, distinct/invalid counts, then
# "<name>\t<occurrences>" sorted. Usage: bash event-names.sh > event-names.txt (from the repo root).
set -euo pipefail
node --input-type=module -e '
import ts from "typescript";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const files = execFileSync("git", ["ls-files", "--", "app", "components", "features", "lib", "proxy.ts", "instrumentation.ts"], { encoding: "utf8" })
  .split("\n").filter((f) => /\.(ts|tsx)$/.test(f));
const fieldsSrc = readFileSync("lib/log/fields.ts", "utf8");
const pattern = new RegExp(/EVENT_PATTERN = \/(.+)\/;/.exec(fieldsSrc)[1]);
const counts = new Map();
let consts = new Map();
const add = (node) => {
  if (node && ts.isIdentifier(node) && consts.has(node.text)) { const v = consts.get(node.text); counts.set(v, (counts.get(v) ?? 0) + 1); return; }
  if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) counts.set(node.text, (counts.get(node.text) ?? 0) + 1);
};
const callee = (expr) => (ts.isIdentifier(expr) ? expr.text : ts.isPropertyAccessExpression(expr) ? expr.name.text : "");
for (const file of files) {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  consts = new Map();
  const collect = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isStringLiteral(node.initializer)) consts.set(node.name.text, node.initializer.text);
    ts.forEachChild(node, collect);
  };
  collect(sf);
  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && ((ts.isIdentifier(node.name) && node.name.text === "event") || (ts.isStringLiteral(node.name) && node.name.text === "event"))) add(node.initializer);
    if (ts.isCallExpression(node)) {
      const name = callee(node.expression);
      if (name === "reportClientError") add(node.arguments[0]);
      if (name === "clientErrorMessage") add(node.arguments[2]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}
const names = [...counts.keys()].sort();
const invalid = names.filter((n) => !pattern.test(n));
console.log("# event names in app/ components/ features/ lib/ proxy.ts instrumentation.ts (event: literal, reportClientError, clientErrorMessage arg 3)");
console.log(`files=${files.length} distinct=${names.length} invalid=${invalid.length}${invalid.length ? " " + JSON.stringify(invalid) : ""}`);
for (const n of names) console.log(`${n}\t${counts.get(n)}`);
'
