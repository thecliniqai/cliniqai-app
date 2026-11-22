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

/** The size of every page of the PDF in points, in page order (`/MediaBox [0 0 w h]`), rounded to two decimals. */
export function pdfPageSizes(pdf: Buffer): Array<{ width: number; height: number }> {
  const raw = pdf.toString("latin1");
  return [...raw.matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g)].map((m) => ({
    width: Math.round((Number(m[3]) - Number(m[1])) * 100) / 100,
    height: Math.round((Number(m[4]) - Number(m[2])) * 100) / 100,
  }));
}

/** A4 and A5 in points as the renderer writes them. */
export const PAGE_A4 = { width: 595.28, height: 841.89 } as const;
export const PAGE_A5 = { width: 419.53, height: 595.28 } as const;

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
/** `m` applied after `n` in PDF order (the result maps a point through `n` first, then `m`... as `cm` concatenates: new = m x current). */
function multiply(m: Matrix, current: Matrix): Matrix {
  return [
    m[0] * current[0] + m[1] * current[2],
    m[0] * current[1] + m[1] * current[3],
    m[2] * current[0] + m[3] * current[2],
    m[2] * current[1] + m[3] * current[3],
    m[4] * current[0] + m[5] * current[2] + current[4],
    m[4] * current[1] + m[5] * current[3] + current[5],
  ];
}

export interface PdfTextPosition {
  /** 1-based page number (the order of the content streams that draw text). */
  page: number;
  text: string;
  x: number;
  /** Distance of the text's baseline from the TOP edge of the page, in points. */
  yFromTop: number;
}

/**
 * Where every text run of the PDF is drawn (the baseline origin of each `BT ... ET` block), with the transformation matrix the renderer builds from nested
 * `q`/`Q` and `cm` operators followed. Enough to assert that nothing is printed inside a margin; not a general PDF interpreter (no clipping, no text state).
 */
export function pdfTextPositions(pdf: Buffer): PdfTextPosition[] {
  const sizes = pdfPageSizes(pdf);
  const raw = pdf.toString("latin1");
  const out: PdfTextPosition[] = [];
  let page = 0;
  for (const m of raw.matchAll(/stream\r?\n/g)) {
    const start = (m.index ?? 0) + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) continue;
    const bytes = pdf.subarray(start, end);
    let content: string;
    try {
      content = inflateSync(bytes).toString("latin1");
    } catch {
      continue;
    }
    if (!/\bBT\b/.test(content)) continue;
    page += 1;
    const height = sizes[page - 1]?.height ?? sizes[0]?.height ?? 0;
    const stack: Matrix[] = [];
    let ctm: Matrix = IDENTITY;
    let tm: Matrix = IDENTITY;
    let blockText = "";
    let inText = false;
    for (const line of content.split("\n")) {
      const t = line.trim();
      if (t === "q") stack.push(ctm);
      else if (t === "Q") ctm = stack.pop() ?? ctm;
      else if (t.endsWith(" cm")) {
        const n = t.slice(0, -3).trim().split(/\s+/).map(Number);
        if (n.length === 6) ctm = multiply(n as Matrix, ctm);
      } else if (t === "BT") {
        inText = true;
        tm = IDENTITY;
        blockText = "";
      } else if (inText && t.endsWith(" Tm")) {
        const n = t.slice(0, -3).trim().split(/\s+/).map(Number);
        if (n.length === 6) tm = n as Matrix;
      } else if (inText && (t.endsWith(" TJ") || t.endsWith(" Tj"))) {
        blockText += showText(t).join("");
      } else if (t === "ET") {
        inText = false;
        const device = multiply(tm, ctm);
        if (blockText.trim() !== "") out.push({ page, text: blockText, x: Math.round(device[4] * 100) / 100, yFromTop: Math.round((height - device[5]) * 100) / 100 });
      }
    }
  }
  return out;
}

/** The document information a PDF carries (`/Info`: title, creation and modification date as the writer printed them), for metadata assertions. */
export function pdfInfo(pdf: Buffer): { title: string | null; creationDate: string | null; modDate: string | null } {
  const raw = pdf.toString("latin1");
  const ref = (key: string): string | null => {
    const r = new RegExp(`/${key} (\\d+) 0 R`).exec(raw);
    if (!r) return null;
    const obj = new RegExp(`\\n${r[1]} 0 obj\\n\\(([^\\n]*)\\)\\nendobj`).exec(raw);
    return obj ? decodeLiteral(obj[1]) : null;
  };
  return { title: ref("Title"), creationDate: ref("CreationDate"), modDate: ref("ModificationDate") };
}
