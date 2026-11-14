/**
 * Source helpers shared by the UI policy rules (scripts/ci/ui-policy/rules/*.mjs; V2-06 06-01a step 5). Rules get the
 * parsed TypeScript SourceFile and use these to read class strings without regex over raw source: comments, import
 * paths and identifiers are never class text.
 */
import ts from "typescript";

export { ts };

/** 1-based line of a source position. */
export function lineAt(sourceFile, pos) {
  return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}

/**
 * String-literal and template-literal text segments ({ text, line, start }), module specifiers excluded. `start` is the
 * source position of the first character of `text`.
 */
export function stringSegments(sourceFile) {
  const out = [];
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isExternalModuleReference(node)) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const start = node.getStart(sourceFile) + 1;
      out.push({ text: node.text, line: lineAt(sourceFile, start), start });
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const start = node.getStart(sourceFile) + 1;
      out.push({ text: node.text, line: lineAt(sourceFile, start), start });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return out;
}

/** Whitespace-delimited tokens of every string segment, each with its own line ({ token, line }). */
export function classTokens(sourceFile) {
  const out = [];
  for (const seg of stringSegments(sourceFile)) {
    for (const m of seg.text.matchAll(/\S+/g)) {
      const before = seg.text.slice(0, m.index);
      out.push({ token: m[0], line: seg.line + (before.match(/\n/g)?.length ?? 0) });
    }
  }
  return out;
}

/** The utility part of a class token: variants (`md:hover:`) and the important marker removed. */
export function utilityOf(token) {
  let depth = 0;
  let cut = 0;
  for (let i = 0; i < token.length; i++) {
    const ch = token[i];
    if (ch === "[") depth++;
    else if (ch === "]") depth--;
    else if (ch === ":" && depth === 0) cut = i + 1;
  }
  return token.slice(cut).replace(/^!|!$/g, "");
}
