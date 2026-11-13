/**
 * Restore SQL guard (V2-04 04-07c, review C M-2 / triage M-BACKUPAUTH; rulings R-29, R-48; hardened 04-07d, N-2).
 *
 * A restore feeds the archive's SQL files to `psql` as `postgres`. psql runs a backslash meta-command (`\! cmd`,
 * `\copy … to`, `\o file`, `\connect`, …) wherever an unquoted backslash appears outside a COPY data block, so a
 * crafted dump could run a shell command next to the decrypted files. This guard reads every SQL file before anything
 * is executed and refuses the archive when psql could see a meta-command. It tracks what psql's own lexer tracks:
 * standard and E'' strings, quoted identifiers, dollar quotes, `--` and nested `/* *\/` comments, and the data lines of
 * `COPY … FROM stdin;` up to the `\.` terminator (data lines are not interpreted by psql).
 *
 * 04-07d (re-verification N-2): psql lexes a '…' string by the server's `standard_conforming_strings` (off: `\'` is an
 * escaped quote), which an archive can change, also from server-side code no text scan can see. The guard is therefore
 * independent of that setting: inside a standard string, a backslash directly before a quote (the only place the two
 * readings part) is refused, so both readings end every string at the same place. It also refuses, independent of the
 * lexer state:
 *   - any line whose first non-space character is a backslash, outside COPY data (other than the two pg_dump lines
 *     below);
 *   - a statement that names `standard_conforming_strings` or `client_encoding` other than pg_dump's own
 *     `SET standard_conforming_strings = on;` and `SET client_encoding = 'UTF8';` (`SET`, `set_config(…)`, `RESET`,
 *     `ALTER … SET`, any spelling that names them);
 *   - a file that is not valid UTF-8 (pg_dump writes UTF8; psql reads multi-byte client encodings differently).
 * These are defense in depth: the restore also runs psql in restricted mode under a key the archive cannot know
 * (`ops/bin/psql-restricted.sh`), so psql itself refuses every meta-command even where a client-encoding switch made
 * by server-side code could still make its lexer part from this one.
 *
 * Allowed, because pg_dump (17.6+, CVE-2025-8714) writes them to *disable* meta-commands: a whole line
 * `\restrict <key>` and `\unrestrict <key>` (key = letters and digits) between statements. With `--emit-dir` the guard
 * writes restore copies in which exactly those lines are comments (the restore's own restricted mode refuses a second
 * `\restrict`). Also refused: `COPY … PROGRAM` (server-side command execution) and anything after
 * `COPY … FROM stdin;` on the same line.
 *
 * Findings name the file, the line number and a reason, never the line's content (a dump holds row data).
 *
 * CLI (run by ops/restore-drill/run.sh before the drill stack starts):
 *   npx tsx ops/restore-drill/sql-guard.ts [--emit-dir <dir>] <file.sql> [...]
 * Exit 0 = no meta-command (and, with --emit-dir, the restore copies written), 1 = refused (each finding printed,
 * nothing written), 2 = usage / unreadable file.
 */
import fs from "node:fs";
import path from "node:path";

export interface GuardFinding {
  line: number;
  reason: string;
}

export interface GuardScan {
  findings: GuardFinding[];
  /** 0-based indexes of the pg_dump `\restrict` / `\unrestrict` lines the guard allowed (between statements). */
  restrictLines: number[];
}

const RESTRICT_LINE = /^\\(?:un)?restrict [A-Za-z0-9]+\r?$/;
const LINE_STARTS_WITH_BACKSLASH = /^\s*\\/;
const IDENT_CHAR = /[A-Za-z0-9_$\u0080-\uffff]/;
const DOLLAR_TAG = /^\$(?:[A-Za-z_\u0080-\uffff][A-Za-z0-9_\u0080-\uffff]*)?\$/;

/** pg_dump's own lines for the two settings psql's lexer depends on; any other statement naming them is refused. */
const SETTING_ALLOWED: ReadonlyArray<[setting: string, onlyForm: string]> = [
  ["standard_conforming_strings", "set standard_conforming_strings = on"],
  ["client_encoding", "set client_encoding = 'utf8'"],
];

const REASON_META = "psql meta-command (unquoted backslash outside COPY data)";
const REASON_LINE_START = "line starts with a backslash outside COPY data (psql meta-command shape)";
const REASON_SCS_AMBIGUOUS =
  "backslash before a quote inside a standard string (read differently when standard_conforming_strings is off)";

/** Statement text with comments and quoted contents removed (for the COPY checks). */
function isCopyFromStdin(stmt: string): boolean {
  return /^\s*copy\s[\s\S]*\bfrom\s+stdin\b/i.test(stmt);
}
function isCopyProgram(stmt: string): boolean {
  return /^\s*copy\s[\s\S]*\b(?:from|to)\s+program\b/i.test(stmt);
}

/** Every place psql could run a meta-command (or a refused COPY form or setting) in `text`, plus the allowed lines. */
export function scanSql(text: string): GuardScan {
  const findings: GuardFinding[] = [];
  const restrictLines: number[] = [];
  const flag = (line: number, reason: string) => {
    // One finding per line is enough to refuse; a second one on the same line would only repeat it.
    if (!findings.some((f) => f.line === line)) findings.push({ line, reason });
  };
  const checkSettings = (raw: string, line: number) => {
    const norm = raw.replace(/\s+/g, " ").trim().toLowerCase();
    for (const [setting, onlyForm] of SETTING_ALLOWED) {
      if (norm.includes(setting) && norm !== onlyForm) {
        flag(line, `statement changes or names ${setting} (only pg_dump's own SET line is allowed)`);
      }
    }
  };

  const lines = text.split("\n");
  // Lexer state across lines.
  let mode: "normal" | "squote" | "estring" | "dquote" | "dollar" | "block" = "normal";
  let dollarTag = "";
  let blockDepth = 0;
  let stmt = ""; // the current statement, quoted contents and comments dropped
  let raw = ""; // the current statement with quoted contents, comments dropped (for the setting checks)
  let rawLine = 0; // where the current statement began
  let copyData = false;
  let copyStartLine = 0;
  let quoteStartLine = 0; // where the open string, identifier, dollar quote or comment began

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const lineNo = li + 1;
    if (copyData) {
      if (line === "\\." || line === "\\.\r") copyData = false;
      continue;
    }
    if (mode === "normal" && RESTRICT_LINE.test(line) && stmt.trim() === "" && raw.trim() === "") {
      restrictLines.push(li);
      continue;
    }
    if (raw.trim() === "") rawLine = lineNo;

    let i = 0;
    // Start of the current non-comment segment of this line (-1 while inside a comment).
    let seg = mode === "block" ? -1 : 0;
    let copyPendingRest = false;
    while (i < line.length) {
      const c = line[i];
      const next = line[i + 1];
      if (copyPendingRest) {
        // Only whitespace may follow `COPY … FROM stdin;` on its line.
        if (!/\s/.test(c)) {
          flag(lineNo, "content after COPY … FROM stdin; on the same line");
          break;
        }
        i++;
        continue;
      }
      switch (mode) {
        case "squote":
          if (c === "\\") {
            // standard_conforming_strings on: a plain character; off: an escape of the next character. The two
            // readings agree except when the next character is a quote (`\\` is two plain characters or one escaped
            // backslash, followed by the same thing either way).
            if (next === "'") {
              flag(lineNo, REASON_SCS_AMBIGUOUS);
              i++; // continue with pg_dump's reading (on): the backslash is a plain character
            } else i += next === undefined ? 1 : 2;
          } else if (c === "'") {
            if (next === "'") i += 2;
            else {
              mode = "normal";
              i++;
            }
          } else i++;
          continue;
        case "estring":
          if (c === "\\") i += 2;
          else if (c === "'") {
            if (next === "'") i += 2;
            else {
              mode = "normal";
              i++;
            }
          } else i++;
          continue;
        case "dquote":
          if (c === '"') {
            if (next === '"') i += 2;
            else {
              mode = "normal";
              stmt += '""';
              i++;
            }
          } else i++;
          continue;
        case "dollar":
          if (c === "$" && line.startsWith(dollarTag, i)) {
            mode = "normal";
            i += dollarTag.length;
          } else i++;
          continue;
        case "block":
          if (c === "/" && next === "*") {
            blockDepth++;
            i += 2;
          } else if (c === "*" && next === "/") {
            blockDepth--;
            i += 2;
            if (blockDepth === 0) {
              mode = "normal";
              seg = i;
            }
          } else i++;
          continue;
        case "normal":
          break;
      }
      // normal
      if (c === "-" && next === "-") {
        // line comment
        raw += line.slice(seg, i);
        seg = -1;
        break;
      }
      if (c === "/" && next === "*") {
        raw += line.slice(seg, i);
        seg = -1;
        mode = "block";
        blockDepth = 1;
        quoteStartLine = lineNo;
        i += 2;
        continue;
      }
      if (c === "\\") {
        flag(lineNo, REASON_META);
        break; // psql would treat the rest of the line as the command's arguments
      }
      if (c === "'") {
        const prev = line[i - 1];
        const before = line[i - 2];
        const eString = (prev === "E" || prev === "e") && (before === undefined || !IDENT_CHAR.test(before));
        mode = eString ? "estring" : "squote";
        quoteStartLine = lineNo;
        stmt += "''";
        i++;
        continue;
      }
      if (c === '"') {
        mode = "dquote";
        quoteStartLine = lineNo;
        i++;
        continue;
      }
      if (c === "$" && !(i > 0 && IDENT_CHAR.test(line[i - 1]))) {
        const m = DOLLAR_TAG.exec(line.slice(i));
        if (m) {
          mode = "dollar";
          dollarTag = m[0];
          quoteStartLine = lineNo;
          stmt += "$$";
          i += m[0].length;
          continue;
        }
      }
      if (c === ";") {
        raw += line.slice(seg, i);
        checkSettings(raw, rawLine);
        raw = "";
        seg = i + 1;
        rawLine = lineNo;
        if (isCopyProgram(stmt)) flag(lineNo, "COPY … PROGRAM (server-side command)");
        if (isCopyFromStdin(stmt)) {
          copyData = true;
          copyStartLine = lineNo;
          copyPendingRest = true;
        }
        stmt = "";
        i++;
        continue;
      }
      stmt += c;
      i++;
    }
    // Lexer-independent (04-07d N-2): no line of a pg_dump file outside COPY data starts with a backslash, whatever this
    // lexer believes the quoting state to be (checked after the line, so a meta-command the lexer saw keeps its reason).
    if (LINE_STARTS_WITH_BACKSLASH.test(line)) flag(lineNo, REASON_LINE_START);
    if (seg >= 0 && !copyPendingRest) raw += line.slice(seg);
    if (!copyPendingRest) raw += "\n";
    if (mode === "normal" && !copyPendingRest) stmt += "\n";
    // A string, identifier or dollar quote that spans lines keeps its mode; a line comment ends here.
  }
  if (raw.trim() !== "") checkSettings(raw, rawLine);
  if (copyData) flag(copyStartLine, "COPY … FROM stdin without its \\. terminator");
  if (mode !== "normal") flag(quoteStartLine, `unterminated ${mode === "block" ? "comment" : "quoted text"} at end of file`);
  return { findings: findings.sort((a, b) => a.line - b.line), restrictLines };
}

/** Every place psql could run a meta-command (or a refused COPY form or setting) in `text`. */
export function findMetaCommands(text: string): GuardFinding[] {
  return scanSql(text).findings;
}

/** A file's bytes: refused unless valid UTF-8 (pg_dump writes UTF8), else the findings of {@link scanSql}. */
export function guardBytes(bytes: Uint8Array): GuardScan & { text: string } {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    const text = decoder.decode(bytes);
    return { ...scanSql(text), text };
  } catch {
    // Name the first line that does not decode, never its content.
    let line = 1;
    let start = 0;
    for (let i = 0; i <= bytes.length; i++) {
      if (i === bytes.length || bytes[i] === 0x0a) {
        try {
          decoder.decode(bytes.subarray(start, i));
        } catch {
          break;
        }
        line++;
        start = i + 1;
      }
    }
    return { findings: [{ line, reason: "not valid UTF-8 (pg_dump writes UTF8)" }], restrictLines: [], text: "" };
  }
}

/** The restore copy of a guarded file: the allowed pg_dump `\restrict` / `\unrestrict` lines become comments. */
export function restoreCopy(text: string, restrictLines: number[]): string {
  const lines = text.split("\n");
  for (const li of restrictLines) {
    lines[li] = "-- pg_dump restrict line removed: the restore runs psql restricted under its own key";
  }
  return lines.join("\n");
}

function main(argv: string[]): number {
  let emitDir: string | null = null;
  const files: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--emit-dir" && emitDir === null && argv[i + 1] && !argv[i + 1].startsWith("-")) {
      emitDir = argv[++i];
    } else if (argv[i].startsWith("-")) {
      files.length = 0;
      break;
    } else files.push(argv[i]);
  }
  if (files.length === 0) {
    process.stderr.write("usage: sql-guard.ts [--emit-dir <dir>] <file.sql> [...]\n");
    return 2;
  }
  if (emitDir !== null && new Set(files.map((f) => path.basename(f))).size !== files.length) {
    process.stderr.write("sql-guard: --emit-dir needs distinct file names\n");
    return 2;
  }
  let refused = 0;
  const copies: Array<[string, string]> = [];
  for (const file of files) {
    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(file);
    } catch {
      process.stderr.write(`sql-guard: cannot read ${path.basename(file)}\n`);
      return 2;
    }
    const scan = guardBytes(bytes);
    for (const f of scan.findings) {
      refused++;
      process.stderr.write(`sql-guard: REFUSED ${path.basename(file)}:${f.line} ${f.reason}\n`);
    }
    if (scan.findings.length === 0) copies.push([path.basename(file), restoreCopy(scan.text, scan.restrictLines)]);
  }
  if (refused) {
    process.stderr.write(`sql-guard: ${refused} finding(s); the archive is refused (nothing was executed)\n`);
    return 1;
  }
  if (emitDir !== null) {
    fs.mkdirSync(emitDir, { recursive: true, mode: 0o700 });
    for (const [name, text] of copies) fs.writeFileSync(path.join(emitDir, name), text, { mode: 0o600 });
  }
  process.stdout.write(
    `sql-guard: PASS (${files.length} file(s), no psql meta-command)` +
      (emitDir !== null ? `; restore copies written (${copies.length})` : "") +
      "\n"
  );
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  process.exitCode = main(process.argv.slice(2));
}
