/**
 * AI_STRATEGY §5.3 (AI-06): the AI SDK (`ai`, `@ai-sdk/*`) is imported only by the server-side AI layer in lib/ai/**.
 * Report mode in V2-06; the AI-06 L1 checks in scripts/ci/ai-l1-greps.mjs stay the blocking gate.
 */
import { lineAt, ts } from "../source.mjs";

const AI_SDK = /^(ai|ai\/.+|@ai-sdk\/.+)$/;

export default {
  id: "ai-sdk-import",
  mode: "report",
  reason: "AI SDK import outside lib/ai/** (AI_STRATEGY §5.3).",
  check(file, sourceFile) {
    if (file.startsWith("lib/ai/")) return [];
    const out = [];
    const visit = (node) => {
      const spec =
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
          ? node.moduleSpecifier.text
          : ts.isCallExpression(node) &&
              (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
                (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
              node.arguments[0] &&
              ts.isStringLiteral(node.arguments[0])
            ? node.arguments[0].text
            : null;
      if (spec && AI_SDK.test(spec)) out.push({ line: lineAt(sourceFile, node.getStart(sourceFile)), detail: spec });
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return out;
  },
};
