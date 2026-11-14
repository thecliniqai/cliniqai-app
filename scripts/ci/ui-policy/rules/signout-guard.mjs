/**
 * Sign-out guard (PWA_STRATEGY §4 D-5, §9.1 spec 11; V2-06 06-05, ruling R-19; 06-09a M-GUARD; T-06-06). ENFORCED.
 *
 * Every exit path must go through `hardSignOut()` (`lib/auth/hard-sign-out.ts`), which also purges the device and tells
 * the other tabs; a stray Supabase `auth.signOut()` would end the session and leave caches, storage and other tabs
 * behind. In app/, components/, features/ and lib/ each of these is a finding:
 *   - a `signOut` property access, element access or destructuring (`x.signOut`, `x["signOut"]`, `{ signOut }`);
 *   - any string expression that folds to "signOut" (`auth[`sign${"Out"}`]`, `auth["sign" + "Out"]`,
 *     `Reflect.get(auth, "signOut")`, `const k = "signOut"`);
 *   - a computed key whose value the rule cannot see on something named `auth` (`auth[k]`, `x.auth[k]`,
 *     `Reflect.get(x.auth, k)`);
 *   - a string or template containing GoTrue's logout path `/auth/v1/logout` (a direct `fetch` to it).
 *
 * Files are exempt by explicit name only, never by folder or directive (06-09a: a directive-less module imported by a
 * "use client" page runs in the browser, so "no `use client`" does not mean "server"):
 *   - lib/auth/hard-sign-out.ts: the helper; its fallback is the only browser call;
 *   - app/auth/signout/route.ts: the server sign-out route (a route handler, server by construction);
 *   - features/auth/service.ts: server-side password changes; must keep `import "server-only"` (else a finding).
 * `proxy.ts` (repository root, server-only, H-AUTH revocation) is outside the scanned roots.
 * Identifiers that merely contain the word (`signOutScope`, `hardSignOut`, a local `const signOut = …`) are not findings.
 */
import { lineAt, ts } from "../source.mjs";

const NAME = "signOut";
const LOGOUT_PATH = /\/auth\/v1\/logout/;
/** Unknown parts of a string expression (identifiers, calls) fold to this marker. */
const UNKNOWN = "\u0000";

/** file → { reason, serverOnly: the file must import "server-only" to stay exempt } */
const ALLOWED = new Map([
  ["lib/auth/hard-sign-out.ts", { reason: "the exit helper", serverOnly: false }],
  ["app/auth/signout/route.ts", { reason: "the server sign-out route", serverOnly: false }],
  ["features/auth/service.ts", { reason: "server-side password changes", serverOnly: true }],
]);

function importsServerOnly(sourceFile) {
  return sourceFile.statements.some(
    (s) => ts.isImportDeclaration(s) && !s.importClause && ts.isStringLiteral(s.moduleSpecifier) && s.moduleSpecifier.text === "server-only",
  );
}

/**
 * The text of a string expression, with UNKNOWN for parts the rule cannot evaluate, or null when the node is not a
 * string expression at all. `complete` is false when any part is unknown.
 */
function fold(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return { text: node.text, complete: true };
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression?.(node) || ts.isTypeAssertionExpression(node)) {
    return fold(node.expression);
  }
  if (ts.isTemplateExpression(node)) {
    let text = node.head.text;
    let complete = true;
    for (const span of node.templateSpans) {
      const part = fold(span.expression);
      text += part ? part.text : UNKNOWN;
      complete &&= Boolean(part?.complete);
      text += span.literal.text;
    }
    return { text, complete };
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = fold(node.left);
    const right = fold(node.right);
    if (!left && !right) return null;
    return {
      text: (left ? left.text : UNKNOWN) + (right ? right.text : UNKNOWN),
      complete: Boolean(left?.complete && right?.complete),
    };
  }
  return null;
}

/** True for `auth` and `<anything>.auth` (the Supabase auth client by its usual names). */
function isAuthObject(node) {
  if (ts.isIdentifier(node)) return node.text === "auth";
  if (ts.isPropertyAccessExpression(node)) return node.name.text === "auth";
  if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)) return isAuthObject(node.expression);
  return false;
}

function bindingName(name) {
  if (!name) return null;
  if (ts.isIdentifier(name)) return { text: name.text, complete: true };
  if (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return { text: name.text, complete: true };
  if (ts.isComputedPropertyName(name)) return fold(name.expression) ?? { text: UNKNOWN, complete: false };
  return null;
}

function isReflectGet(node) {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "Reflect" &&
    ["get", "apply", "getOwnPropertyDescriptor"].includes(node.expression.name.text)
  );
}

const signoutGuard = {
  id: "signout-guard",
  mode: "enforce",
  reason: "signOut outside hardSignOut() skips the device purge (PWA_STRATEGY §4 D-5); call hardSignOut(reason).",
  check(file, sourceFile) {
    const allowed = ALLOWED.get(file);
    if (allowed && !allowed.serverOnly) return [];
    if (allowed && allowed.serverOnly) {
      if (importsServerOnly(sourceFile)) return [];
      return [{ line: 1, detail: `exempt as ${allowed.reason} only with import "server-only"` }];
    }
    const out = [];
    const hit = (node, detail) => out.push({ line: lineAt(sourceFile, node.getStart(sourceFile)), detail });
    const visit = (node) => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;

      if (ts.isPropertyAccessExpression(node) && node.name.text === NAME) {
        hit(node, `${node.expression.getText(sourceFile)}.${NAME}`);
        return;
      }
      if (ts.isElementAccessExpression(node)) {
        const key = fold(node.argumentExpression);
        if (key?.complete && key.text === NAME) {
          hit(node, `${node.expression.getText(sourceFile)}["${NAME}"]`);
          return;
        }
        if (!key?.complete && isAuthObject(node.expression)) {
          hit(node, `${node.expression.getText(sourceFile)}[<computed>]`);
          return;
        }
      }
      if (isReflectGet(node)) {
        const [target, key] = node.arguments;
        const folded = key ? fold(key) : null;
        if (target && isAuthObject(target) && !(folded?.complete && folded.text !== NAME)) {
          hit(node, `Reflect.${node.expression.name.text}(${target.getText(sourceFile)}, …)`);
          return;
        }
      }
      if (ts.isBindingElement(node)) {
        const name = bindingName(node.propertyName ?? node.name);
        if (name && name.complete && name.text === NAME) hit(node, `{ ${NAME} } destructured`);
        else if (name && !name.complete && ts.isObjectBindingPattern(node.parent)) {
          const init = node.parent.parent && ts.isVariableDeclaration(node.parent.parent) ? node.parent.parent.initializer : undefined;
          if (init && isAuthObject(init)) hit(node, "{ [<computed>] } destructured from auth");
        }
      }
      const text = fold(node);
      if (text && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node) || ts.isBinaryExpression(node))) {
        if (text.complete && text.text === NAME) {
          hit(node, `"${NAME}" string`);
          return;
        }
        if (LOGOUT_PATH.test(text.text)) {
          hit(node, "GoTrue logout URL (/auth/v1/logout)");
          return;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return out;
  },
};

export default signoutGuard;
