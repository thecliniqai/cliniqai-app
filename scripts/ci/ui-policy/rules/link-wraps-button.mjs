/** DESIGN_SYSTEM §6.1, §8: a link must not wrap a button (nested interactive content; one control, one role). */
import { lineAt, ts } from "../source.mjs";

const LINKS = new Set(["a", "Link"]);
const BUTTONS = new Set(["button", "Button"]);

const tagOf = (node) =>
  ts.isJsxElement(node) ? node.openingElement.tagName.getText() : ts.isJsxSelfClosingElement(node) ? node.tagName.getText() : null;

export default {
  id: "link-wraps-button",
  mode: "report",
  reason: "A link wraps a button; style the link as a button instead (DESIGN_SYSTEM §6.1).",
  check(file, sourceFile) {
    const out = [];
    const visit = (node, insideLink) => {
      const tag = tagOf(node);
      if (tag && insideLink && BUTTONS.has(tag)) {
        out.push({ line: lineAt(sourceFile, node.getStart(sourceFile)), detail: `<${insideLink}> wraps <${tag}>` });
      }
      const next = tag && LINKS.has(tag) ? tag : insideLink;
      ts.forEachChild(node, (child) => visit(child, next));
    };
    visit(sourceFile, null);
    return out;
  },
};
