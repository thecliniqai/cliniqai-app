#!/usr/bin/env node
/**
 * Error-sink export check (V2-03 03-09b; PO action E9 "Verify").
 *
 *   node scripts/ops/check-error-export.mjs <export.json>
 *
 * Passes (exit 0) only if the file is a non-empty JSON array of `ops.error_events` rows whose keys are exactly the
 * allowed (scrubbed) column set, every column has its stored shape, and no PII pattern (email, Indian mobile, Aadhaar,
 * ABHA, PAN, digit run of 6+, UUID, JWT, long token, credential, query string, quoted input value, unredacted Postgres
 * row detail) matches any text column. Accepts the array itself or the SQL editor's one-cell form `[{"export": [...]}]` of the runbook query.
 * Failures name the row, column and rule, never the value. Reads only the given file; no network, no database.
 *
 * This detector is deliberately independent of lib/observability/scrub.ts: it is the second opinion on the scrubber.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const ALLOWED_COLUMNS = [
  "fingerprint",
  "occurred_on",
  "first_seen",
  "last_seen",
  "count",
  "environment",
  "release",
  "route_path",
  "route_type",
  "method",
  "error_name",
  "error_code",
  "digest",
  "message",
  "frames",
  "request_id",
  "tenant_id",
  "user_id",
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)?$/;

/** Column → shape predicate (null allowed where the column is nullable). */
const SHAPES = {
  fingerprint: (v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v),
  occurred_on: (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v),
  first_seen: (v) => typeof v === "string" && TIMESTAMP.test(v),
  last_seen: (v) => typeof v === "string" && TIMESTAMP.test(v),
  count: (v) => Number.isInteger(v) && v >= 1,
  environment: (v) => ["development", "test", "e2e", "ci", "staging", "production"].includes(v),
  release: (v) => v === null || (typeof v === "string" && /^[0-9a-f]{7,40}$/.test(v)),
  route_path: (v) => v === null || (typeof v === "string" && /^\/[A-Za-z0-9_./()[\]@~+-]{0,199}$/.test(v)),
  route_type: (v) => v === null || ["render", "route", "action", "proxy"].includes(v),
  method: (v) => v === null || (typeof v === "string" && /^[A-Z]{1,10}$/.test(v)),
  error_name: (v) => typeof v === "string" && /^[A-Za-z0-9_.$-]{1,80}$/.test(v),
  error_code: (v) => v === null || (typeof v === "string" && /^[A-Za-z0-9_.-]{1,40}$/.test(v)),
  digest: (v) => v === null || (typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v)),
  message: (v) => typeof v === "string" && v.length <= 500,
  frames: (v) =>
    Array.isArray(v) &&
    v.length <= 20 &&
    v.every((f) => typeof f === "string" && /^[A-Za-z0-9_./()[\]@~+:-]{1,200}:[0-9]{1,7}$/.test(f)),
  request_id: (v) => v === null || (typeof v === "string" && UUID.test(v)),
  tenant_id: (v) => v === null || (typeof v === "string" && UUID.test(v)),
  user_id: (v) => v === null || (typeof v === "string" && UUID.test(v)),
};

/** PII and secret patterns that must not match any stored text. */
export const PII_PATTERNS = [
  ["email", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
  ["indian-mobile", /(?:\+91[\s-]?|\b0)?\b[6-9][\d\s-]{8,13}\d/],
  ["aadhaar", /\b\d{4}\s\d{4}\s\d{4}\b/],
  ["abha", /\b\d{2}-\d{4}-\d{4}-\d{4}\b/],
  ["pan", /\b[A-Z]{5}[0-9]{4}[A-Z]\b/i],
  ["digit-run", /\d{6,}/],
  ["uuid", /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i],
  ["jwt", /eyJ[A-Za-z0-9_-]{5,}\./],
  ["long-token", /(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{16,}/],
  ["query-string", /\?(?!\[QUERY\])[^\s]*/],
  ["query-pair", /[?&][A-Za-z0-9_.-]+=/],
  ["pg-key-detail", /Key \([^)]*\)=\((?!\[REDACTED\]\))/],
  ["pg-failing-row", /Failing row contains \((?!\[REDACTED\]\))/],
  ["quoted-value", /:\s*"(?!\[VALUE\]")[^"\n]*"/],
  ["quoted-value", /:\s*'(?!\[VALUE\]')[^'\n]*'/],
  ["credential", /\b(?:Bearer|Basic)\s+(?!\[TOKEN\])\S+/i],
];

/** The indian-mobile pattern is broad; a match counts only when it holds at least 10 digits. */
function piiRulesMatching(text) {
  const hits = [];
  for (const [rule, pattern] of PII_PATTERNS) {
    if (rule === "indian-mobile") {
      const all = new RegExp(pattern.source, `${pattern.flags}g`);
      if ([...text.matchAll(all)].some((m) => m[0].replace(/\D/g, "").length >= 10)) hits.push(rule);
    } else if (pattern.test(text)) {
      hits.push(rule);
    }
  }
  return hits;
}

/** The text a column contributes to the PII scan (frames: the file part, without the `:line`). */
function scannedText(column, value) {
  if (value === null || value === undefined) return [];
  if (column === "frames") return value.map((f) => String(f).replace(/:\d+$/, ""));
  if (["message", "route_path", "error_name", "error_code"].includes(column)) return [String(value)];
  return [];
}

/** Every problem with the parsed export, as `row N column: rule` strings (no values). */
export function checkErrorExport(parsed) {
  let rows = parsed;
  if (
    Array.isArray(rows) &&
    rows.length === 1 &&
    rows[0] &&
    typeof rows[0] === "object" &&
    Object.keys(rows[0]).length === 1 &&
    Array.isArray(rows[0].export)
  ) {
    rows = rows[0].export;
  }
  if (!Array.isArray(rows)) return ["export: not a JSON array of rows"];
  if (rows.length === 0) return ["export: no rows (nothing proven)"];
  const problems = [];
  rows.forEach((row, i) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      problems.push(`row ${i}: not an object`);
      return;
    }
    const keys = Object.keys(row);
    for (const key of keys) if (!ALLOWED_COLUMNS.includes(key)) problems.push(`row ${i} ${key}: column not allowed`);
    for (const column of ALLOWED_COLUMNS) {
      if (!(column in row)) {
        problems.push(`row ${i} ${column}: column missing`);
        continue;
      }
      const value = row[column];
      if (!SHAPES[column](value)) problems.push(`row ${i} ${column}: unexpected shape`);
      for (const text of SHAPES[column](value) ? scannedText(column, value) : []) {
        for (const rule of piiRulesMatching(text)) problems.push(`row ${i} ${column}: matches ${rule}`);
      }
    }
  });
  return [...new Set(problems)];
}

function main(argv) {
  const file = argv[2];
  if (!file) {
    console.error("usage: node scripts/ops/check-error-export.mjs <export.json>");
    return 2;
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(resolve(file), "utf8"));
  } catch {
    console.error("check-error-export: the file is not readable JSON");
    return 1;
  }
  const problems = checkErrorExport(parsed);
  if (problems.length > 0) {
    console.error(`check-error-export: FAILED (${problems.length} problem(s))`);
    for (const p of problems) console.error(`  - ${p}`);
    return 1;
  }
  const count = Array.isArray(parsed) && parsed[0] && Array.isArray(parsed[0].export) ? parsed[0].export.length : parsed.length;
  console.log(`check-error-export: OK (${count} row(s); allowed columns only; no PII pattern)`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv);
}
