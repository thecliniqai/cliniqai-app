/** DESIGN_SYSTEM §6.4, §10: no native `alert()` / `confirm()` / `prompt()`; use Dialog / AlertDialog / toast. */
import { lineAt, ts } from "../source.mjs";

const NAMES = new Set(["alert", "confirm", "prompt"]);
const GLOBALS = new Set(["window", "globalThis", "self"]);

export default {
  id: "window-dialog",
  mode: "report",
  reason: "Native browser dialog; use the Dialog/AlertDialog primitives or a toast (DESIGN_SYSTEM §6.4).",
  check(file, sourceFile) {
    const out = [];
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        let name;
        if (ts.isIdentifier(callee) && NAMES.has(callee.text)) name = callee.text;
        else if (
          ts.isPropertyAccessExpression(callee) &&
          ts.isIdentifier(callee.expression) &&
          GLOBALS.has(callee.expression.text) &&
          NAMES.has(callee.name.text)
        ) {
          name = `${callee.expression.text}.${callee.name.text}`;
        }
        if (name) out.push({ line: lineAt(sourceFile, node.getStart(sourceFile)), detail: `${name}()` });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return out;
  },
};
