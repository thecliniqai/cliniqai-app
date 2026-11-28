/**
 * V2-09e 09E-02 (R-20): every exported Server Action names itself to the timing line with `await markAction("<module>.<name>")` as its
 * first statement, so a stalled action shows by name in the function log (the staging finding of 2026-11-23). Read with the TypeScript
 * parser (no regex): each name is a lower-case machine word the logger keeps, unique across the app, and a new action without one fails here.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { sanitiseFields } from "@/lib/log/fields";

const ROOT = path.resolve(__dirname, "../..");

function useServerFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && /^\s*["']use server["']/.test(fs.readFileSync(full, "utf8").slice(0, 200))) out.push(full);
    }
  };
  for (const dir of ["app", "features", "lib", "components"]) walk(path.join(ROOT, dir));
  return out.sort();
}

function firstMarkAction(body: ts.Block): string | null {
  const first = body.statements[0];
  if (!first || !ts.isExpressionStatement(first)) return null;
  const expr = first.expression;
  if (!ts.isAwaitExpression(expr) || !ts.isCallExpression(expr.expression)) return null;
  const call = expr.expression;
  if (!ts.isIdentifier(call.expression) || call.expression.text !== "markAction") return null;
  const arg = call.arguments[0];
  return arg && ts.isStringLiteral(arg) ? arg.text : null;
}

describe("Server Action names for the timing line", () => {
  const seen = new Map<string, string>();
  const missing: string[] = [];
  let total = 0;
  for (const file of useServerFiles()) {
    const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    for (const st of sf.statements) {
      if (!ts.canHaveModifiers(st) || !ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
      const bodies: Array<[string, ts.Block]> = [];
      if (ts.isFunctionDeclaration(st) && st.body && st.name) bodies.push([st.name.text, st.body]);
      if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          const init = d.initializer;
          if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && ts.isBlock(init.body)) bodies.push([d.name.getText(sf), init.body]);
        }
      }
      for (const [name, body] of bodies) {
        total += 1;
        const action = firstMarkAction(body);
        const label = `${path.relative(ROOT, file)}#${name}`;
        if (action === null) missing.push(label);
        else seen.set(action, label);
      }
    }
  }

  it("finds the actions (a parser that saw nothing proves nothing)", () => {
    expect(total).toBeGreaterThan(100);
  });

  it("every exported action starts with await markAction(...)", () => {
    expect(missing, `actions with no markAction as their first statement:\n${missing.join("\n")}`).toEqual([]);
  });

  it("every name is a word the logger keeps and no two actions share one", () => {
    expect(seen.size).toBe(total - missing.length);
    for (const [name, label] of seen) {
      expect(sanitiseFields({ event: "request.start", action: name }).action, `${label}: ${name}`).toBe(name);
    }
  });
});
