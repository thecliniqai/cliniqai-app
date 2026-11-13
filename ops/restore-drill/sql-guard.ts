/**
 * Restore SQL guard (V2-04 04-07c, review C M-2 / triage M-BACKUPAUTH; rulings R-29, R-48).
 *
 * A restore feeds the archive's SQL files to `psql` as `postgres`. psql runs a backslash meta-command (`\! cmd`,
 * `\copy … to`, `\o file`, `\connect`, …) wherever an unquoted backslash appears outside a COPY data block, so a
 * crafted dump could run a shell command next to the decrypted files. This guard reads every SQL file before anything
 * is executed and refuses the archive when psql would see a meta-command. It tracks what psql's own lexer tracks:
 * standard and E'' strings, quoted identifiers, dollar quotes, `--` and nested `/* *\/` comments, and the data lines of
 * `COPY … FROM stdin;` up to the `\.` terminator (data lines are not interpreted by psql).
 *
 * Allowed, because pg_dump (17.6+, CVE-2025-8714) writes them to *disable* meta-commands: a whole line
 * `\restrict <key>` and `\unrestrict <key>` (key = letters and digits). Also refused: `COPY … PROGRAM` (server-side
 * command execution) and anything after `COPY … FROM stdin;` on the same line.
 *
 * Findings name the file, the line number and a reason, never the line's content (a dump holds row data).
 *
 * CLI (run by ops/restore-drill/run.sh before the drill stack starts):
 *   npx tsx ops/restore-drill/sql-guard.ts <file.sql> [...]
 * Exit 0 = no meta-command, 1 = refused (each finding printed), 2 = usage / unreadable file.
 */
import fs from "node:fs";
import path from "node:path";

export interface GuardFinding {
  line: number;
  reason: string;
}

const RESTRICT_LINE = /^\\(?:un)?restrict [A-Za-z0-9]+\r?$/;
const IDENT_CHAR = /[A-Za-z0-9_$\u0080-\uffff]/;
const DOLLAR_TAG = /^\$(?:[A-Za-z_\u0080-\uffff][A-Za-z0-9_\u0080-\uffff]*)?\$/;

/** Statement text with comments and quoted contents removed (for the COPY checks). */
function isCopyFromStdin(stmt: string): boolean {
  return /^\s*copy\s[\s\S]*\bfrom\s+stdin\b/i.test(stmt);
}
function isCopyProgram(stmt: string): boolean {
  return /^\s*copy\s[\s\S]*\b(?:from|to)\s+program\b/i.test(stmt);
}

/** Every place psql would run a meta-command (or a refused COPY form) in `text`. */
export function findMetaCommands(text: string): GuardFinding[] {
  const findings: GuardFinding[] = [];
  const lines = text.split("\n");
  // Lexer state across lines.
  let mode: "normal" | "squote" | "estring" | "dquote" | "dollar" | "block" = "normal";
  let dollarTag = "";
  let blockDepth = 0;
  let stmt = ""; // the current statement, quoted contents and comments dropped
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
    if (mode === "normal" && RESTRICT_LINE.test(line) && stmt.trim() === "") continue;

    let i = 0;
    let copyPendingRest = false;
    while (i < line.length) {
      const c = line[i];
      const next = line[i + 1];
      if (copyPendingRest) {
        // Only whitespace may follow `COPY … FROM stdin;` on its line.
        if (!/\s/.test(c)) {
          findings.push({ line: lineNo, reason: "content after COPY … FROM stdin; on the same line" });
          break;
        }
        i++;
        continue;
      }
      switch (mode) {
        case "squote":
          if (c === "'") {
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
            if (blockDepth === 0) mode = "normal";
          } else i++;
          continue;
        case "normal":
          break;
      }
      // normal
      if (c === "-" && next === "-") break; // line comment
      if (c === "/" && next === "*") {
        mode = "block";
        blockDepth = 1;
        quoteStartLine = lineNo;
        i += 2;
        continue;
      }
      if (c === "\\") {
        findings.push({ line: lineNo, reason: "psql meta-command (unquoted backslash outside COPY data)" });
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
        if (isCopyProgram(stmt)) findings.push({ line: lineNo, reason: "COPY … PROGRAM (server-side command)" });
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
    if (mode === "normal" && !copyPendingRest) stmt += "\n";
    // A string, identifier or dollar quote that spans lines keeps its mode; a line comment ends here.
  }
  if (copyData) findings.push({ line: copyStartLine, reason: "COPY … FROM stdin without its \\. terminator" });
  if (mode !== "normal") findings.push({ line: quoteStartLine, reason: `unterminated ${mode === "block" ? "comment" : "quoted text"} at end of file` });
  return findings;
}

function main(argv: string[]): number {
  if (argv.length === 0 || argv.some((a) => a.startsWith("-"))) {
    process.stderr.write("usage: sql-guard.ts <file.sql> [...]\n");
    return 2;
  }
  let refused = 0;
  for (const file of argv) {
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      process.stderr.write(`sql-guard: cannot read ${path.basename(file)}\n`);
      return 2;
    }
    for (const f of findMetaCommands(text)) {
      refused++;
      process.stderr.write(`sql-guard: REFUSED ${path.basename(file)}:${f.line} ${f.reason}\n`);
    }
  }
  if (refused) {
    process.stderr.write(`sql-guard: ${refused} finding(s); the archive is refused (nothing was executed)\n`);
    return 1;
  }
  process.stdout.write(`sql-guard: PASS (${argv.length} file(s), no psql meta-command)\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  process.exitCode = main(process.argv.slice(2));
}
