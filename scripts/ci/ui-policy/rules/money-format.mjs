/**
 * Money format (DESIGN_SYSTEM §5 "Money (display)", §7.7; V2-10 10-01, D-1). ENFORCED.
 *
 * Every rupee amount on a screen or a document goes through `lib/money` (`formatINR(paise)`, `formatINRAscii`,
 * `formatINRPlain`, `MoneyInput`): one rule for grouping (`₹1,25,000`), paise only when non-zero (`₹499.50`) and a true
 * minus (`−₹50`). In app/, components/, features/ and lib/ (outside lib/money/) each of these is a finding:
 *   - `x.toLocaleString("en-IN", …)` on anything but a date: a receiver that is `new Date(…)`, or options that name a
 *     date or time field (`timeZone`, `day`, `month`, `hour`, `dateStyle`, …), is a date and passes;
 *   - a `+` with a string literal that holds "₹" (`"₹" + amount`);
 *   - a template literal with "₹" right before a substitution (`` `₹${amount}` ``, `` `Collect ₹${x}` ``);
 *   - JSX text ending in "₹" right before an expression (`₹{amount}`, `(₹{fee})`).
 * A "₹" on its own (a column heading, an input adornment, a fixed message such as "₹10,00,000") is not a finding.
 *
 * Exempt by explicit file name only (legacy screens that later plans rewrite; each entry names the plan that removes it):
 *   - components/queue/checkout-drawer.tsx (10-02 fee chips, 10-03 line commands);
 *   - components/consultation/sign-and-bill-modal.tsx (10-02 Sign & Bill context, MoneyInput).
 */
import { lineAt, ts } from "../source.mjs";

const RUPEE = "₹";
const ALLOWED = new Map([
  ["components/queue/checkout-drawer.tsx", "10-02 / 10-03 rewrite"],
  ["components/consultation/sign-and-bill-modal.tsx", "10-02 rewrite"],
]);
const DATE_KEYS = new Set([
  "timeZone", "dateStyle", "timeStyle", "weekday", "era", "year", "month", "day", "hour", "minute", "second", "hour12",
  "hourCycle", "timeZoneName", "dayPeriod", "fractionalSecondDigits",
]);

function isEnIn(node) {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text.toLowerCase() === "en-in";
}

function unwrap(node) {
  let n = node;
  while (n && (ts.isParenthesizedExpression(n) || ts.isNonNullExpression(n) || ts.isAsExpression(n))) n = n.expression;
  return n;
}

function isDateReceiver(node) {
  const n = unwrap(node);
  return Boolean(n && ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "Date");
}

function hasDateOptions(node) {
  if (!node || !ts.isObjectLiteralExpression(node)) return false;
  return node.properties.some((p) => p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && DATE_KEYS.has(p.name.text));
}

function isStringLiteralWithRupee(node) {
  const n = unwrap(node);
  return Boolean(n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && n.text.includes(RUPEE));
}

function isPlainString(node) {
  const n = unwrap(node);
  return Boolean(n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)));
}

const moneyFormat = {
  id: "money-format",
  mode: "enforce",
  reason: "Rupee amount formatted by hand; use formatINR(paise) / MoneyInput from lib/money (DESIGN_SYSTEM §7.7).",
  check(file, sourceFile) {
    if (file.startsWith("lib/money/") || ALLOWED.has(file)) return [];
    const out = [];
    const hit = (node, detail) => out.push({ line: lineAt(sourceFile, node.getStart(sourceFile)), detail });
    const visit = (node) => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;

      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "toLocaleString" &&
        isEnIn(node.arguments[0]) &&
        !isDateReceiver(node.expression.expression) &&
        !hasDateOptions(node.arguments[1])
      ) {
        hit(node, 'toLocaleString("en-IN") on an amount');
      }

      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const left = isStringLiteralWithRupee(node.left);
        const right = isStringLiteralWithRupee(node.right);
        if ((left && !isPlainString(node.right)) || (right && !isPlainString(node.left))) hit(node, '"₹" + amount');
      }

      if (ts.isTemplateExpression(node)) {
        const parts = [node.head, ...node.templateSpans.slice(0, -1).map((s) => s.literal)];
        if (parts.some((p) => p.text.endsWith(RUPEE))) hit(node, "`₹${amount}`");
      }

      if (ts.isJsxText(node) && node.text.trimEnd().endsWith(RUPEE)) {
        const parent = node.parent;
        const siblings = parent && (ts.isJsxElement(parent) || ts.isJsxFragment(parent)) ? parent.children : [];
        const next = siblings[siblings.indexOf(node) + 1];
        if (next && ts.isJsxExpression(next) && next.expression) hit(node, "₹{amount} in JSX");
      }

      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return out;
  },
};

export default moneyFormat;
