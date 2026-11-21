/**
 * The text a PDF shows on its pages, for assertions on rendered bytes (V2-09a 09A-06a, review S-8). No dependency: every content stream is inflated with
 * node:zlib, and the strings of the text-showing operators (`Tj`, `TJ`) are decoded. @react-pdf/renderer (pdfkit) writes the standard fonts as hex
 * strings of their WinAnsi codes, split by kerning numbers inside a TJ array; the segments of one array are joined, so a line reads as typed.
 * Good enough for the Latin text this app prints; not a general PDF parser.
 */
import { inflateSync } from "node:zlib";

function decodeLiteral(s: string): string {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_m, esc: string) => {
    const map: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" };
    return map[esc] ?? String.fromCharCode(parseInt(esc, 8));
  });
}

function decodeHex(hex: string): string {
  const clean = hex.replace(/\s+/g, "");
  let out = "";
  for (let i = 0; i + 1 < clean.length; i += 2) out += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16));
  return out;
}

/** The decoded strings of one content stream, one entry per Tj / TJ operator. */
function showText(content: string): string[] {
  const lines: string[] = [];
  const op = /\[((?:[^\]\\]|\\.)*)\]\s*TJ|(<[0-9A-Fa-f\s]*>|\((?:[^()\\]|\\.)*\))\s*Tj/g;
  for (const m of content.matchAll(op)) {
    const body = m[1] ?? m[2] ?? "";
    let text = "";
    for (const part of body.matchAll(/<([0-9A-Fa-f\s]*)>|\(((?:[^()\\]|\\.)*)\)/g)) {
      text += part[1] !== undefined ? decodeHex(part[1]) : decodeLiteral(part[2] ?? "");
    }
    lines.push(text);
  }
  return lines;
}

/** Every text line drawn in the PDF, in stream order. */
export function pdfTextLines(pdf: Buffer): string[] {
  const raw = pdf.toString("latin1");
  const lines: string[] = [];
  for (const m of raw.matchAll(/stream\r?\n/g)) {
    const start = (m.index ?? 0) + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) continue;
    const bytes = pdf.subarray(start, end);
    let content: string;
    try {
      content = inflateSync(bytes).toString("latin1");
    } catch {
      content = bytes.toString("latin1");
    }
    lines.push(...showText(content));
  }
  return lines;
}

/** All shown text joined with newlines. */
export function pdfText(pdf: Buffer): string {
  return pdfTextLines(pdf).join("\n");
}
