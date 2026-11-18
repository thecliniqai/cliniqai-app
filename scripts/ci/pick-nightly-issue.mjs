#!/usr/bin/env node
/**
 * Picks the open "Nightly failing" issue the nightly workflow comments on (V2-02 02-06, AR-L1).
 *
 * Reads `gh issue list --json number,title,author` output on stdin and prints the number of the first issue whose
 * title is exactly "Nightly failing" AND that the workflow's own bot opened, or nothing. Anyone can open an issue with
 * that title on a public repo; without the author check the bot would post run links into an attacker-controlled
 * issue (whose body they can edit and which they can close). The workflow also passes `--author app/github-actions`
 * to the query; this is the second, tested check.
 *
 * Usage: gh issue list … --json number,title,author | node scripts/ci/pick-nightly-issue.mjs [--title "<title>"]
 * `--title` (V2-04 04-05a) picks another bot-owned alert issue, e.g. "Staging backup failing" for backup-alert.yml.
 * Exit 0 always with a number or empty output; exit 2 on unreadable input.
 */
import { readFileSync } from "node:fs";

const titleAt = process.argv.indexOf("--title");
const TITLE = titleAt > -1 ? process.argv[titleAt + 1] : "Nightly failing";
if (!TITLE) {
  console.error("pick-nightly-issue: --title needs a value");
  process.exit(2);
}
/** How `gh` reports the GitHub Actions bot as an author. */
const BOT_LOGINS = new Set(["app/github-actions", "github-actions[bot]", "github-actions"]);

let issues;
try {
  issues = JSON.parse(readFileSync(0, "utf8"));
} catch {
  console.error("pick-nightly-issue: stdin is not JSON");
  process.exit(2);
}
if (!Array.isArray(issues)) {
  console.error("pick-nightly-issue: expected a JSON array");
  process.exit(2);
}
const ours = issues.find(
  (i) => i?.title === TITLE && BOT_LOGINS.has(i?.author?.login) && (i?.author?.is_bot ?? true) === true,
);
if (ours) process.stdout.write(`${ours.number}\n`);
