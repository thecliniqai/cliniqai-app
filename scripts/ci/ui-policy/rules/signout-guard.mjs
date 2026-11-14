/**
 * Sign-out guard (PWA_STRATEGY §4 D-5, §9.1 spec 11; V2-06 06-05, ruling R-19; T-06-06). ENFORCED.
 *
 * Every exit path must go through `hardSignOut()` (`lib/auth/hard-sign-out.ts`), which also purges the device; a
 * stray Supabase `auth.signOut()` would end the session and leave caches and storage behind. So any property access,
 * element access or destructuring named `signOut` in app/, components/, features/ or lib/ is a finding, except in:
 *   - lib/auth/hard-sign-out.ts (the helper; its offline fallback is the only client call allowed);
 *   - app/auth/signout/route.ts (the server sign-out route);
 *   - a file under features/auth/ that is NOT "use client" (today's server sign-outs: service.ts, password-flows.ts).
 * Identifiers that merely contain the word (`signOutScope`, `hardSignOut`) are not findings.
 */
import { lineAt, ts } from "../source.mjs";

const NAME = "signOut";
const ALLOWED_FILES = new Set(["lib/auth/hard-sign-out.ts", "app/auth/signout/route.ts"]);

/** True when the file's first statements include the "use client" directive. */
function isClientModule(sourceFile) {
  for (const statement of sourceFile.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false;
    if (statement.expression.text === "use client") return true;
  }
  return false;
}

function allowed(file, sourceFile) {
  if (ALLOWED_FILES.has(file)) return true;
  return file.startsWith("features/auth/") && !isClientModule(sourceFile);
}

function propertyNameText(name) {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name) && (ts.isStringLiteral(name.expression) || ts.isNoSubstitutionTemplateLiteral(name.expression))) {
    return name.expression.text;
  }
  return null;
}

const signoutGuard = {
  id: "signout-guard",
  mode: "enforce",
  reason: "signOut outside hardSignOut() skips the device purge (PWA_STRATEGY §4 D-5); call hardSignOut(reason).",
  check(file, sourceFile) {
    if (allowed(file, sourceFile)) return [];
    const out = [];
    const hit = (node, detail) => out.push({ line: lineAt(sourceFile, node.getStart(sourceFile)), detail });
    const visit = (node) => {
      if (ts.isPropertyAccessExpression(node) && node.name.text === NAME) {
        hit(node, `${node.expression.getText(sourceFile)}.${NAME}`);
      } else if (
        ts.isElementAccessExpression(node) &&
        (ts.isStringLiteral(node.argumentExpression) || ts.isNoSubstitutionTemplateLiteral(node.argumentExpression)) &&
        node.argumentExpression.text === NAME
      ) {
        hit(node, `${node.expression.getText(sourceFile)}["${NAME}"]`);
      } else if (ts.isBindingElement(node) && propertyNameText(node.propertyName ?? node.name) === NAME) {
        hit(node, `{ ${NAME} } destructured`);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return out;
  },
};

export default signoutGuard;
