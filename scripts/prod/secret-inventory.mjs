#!/usr/bin/env node
/**
 * Secret inventory by NAME only (V2-15 15-02, CTO-2, P0-07 / C49).
 *
 * The PO runs this on their own machine. It collects the NAMES of variables held in the PO's environment stores and
 * prints the rotation checklist from docs/ops/secret-rotation.md. Claude never sees values, and neither does this
 * script: it never opens environment files, never prints or keeps anything that is not a validated variable name,
 * and refuses input that looks like `NAME=value`.
 *
 * Sources (each optional; at least one is needed):
 *   --vercel             runs `vercel env ls <environment>` and keeps the first column of each row (the name)
 *   --github-secrets     runs `gh secret list` (name column only)
 *   --supabase-ref <ref> runs `supabase secrets list --project-ref <ref>` (name column only)
 *   --names-file <path>  one variable name per line (the PO's own file; dotenv-style basenames are refused)
 *   --stdin              one variable name per line on standard input
 *   --environment <e>    production (default) | preview | development, for --vercel
 *
 * Output: a markdown checklist on stdout. Exit 0 = printed, 2 = refused (reason code only, input never echoed back).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{1,127}$/;

/** What each known name needs. `action`: rotate | revoke | none | review. Values are never stored here. */
export const KNOWN = {
  SUPABASE_ACCESS_TOKEN: { action: "revoke", where: "Supabase > Account > Access Tokens (account-wide); must not be in the app env" },
  SUPABASE_SERVICE_ROLE_KEY: { action: "rotate", where: "Supabase > Project Settings > API keys (production project only)" },
  SUPABASE_SECRET_KEY: { action: "rotate", where: "Supabase > Project Settings > API keys (production project only)" },
  NEXT_PUBLIC_SUPABASE_ANON_KEY: { action: "rotate", where: "Supabase publishable key; production project only" },
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: { action: "rotate", where: "Supabase publishable key; production project only" },
  MSG91_AUTH_KEY: { action: "rotate", where: "MSG91 > Authkey > regenerate" },
  MSG91_WEBHOOK_SECRET: { action: "rotate", where: "new random value; update the MSG91 webhook config (header form)" },
  AI_API_KEY: { action: "rotate", where: "AI provider console: delete and recreate (v2 target is Vertex asia-south1)" },
  GEMINI_API_KEY: { action: "revoke", where: "Google AI Studio > API keys: delete" },
  GOOGLE_GENERATIVE_AI_API_KEY: { action: "revoke", where: "Google AI Studio > API keys: delete" },
  GUPSHUP_API_KEY: { action: "revoke", where: "Gupshup console (not used in v2)" },
  TWILIO_AUTH_TOKEN: { action: "revoke", where: "Twilio console (not used in v2)" },
  TWILIO_ACCOUNT_SID: { action: "review", where: "identifier, not a secret; remove if Twilio is unused" },
  R2_ACCESS_KEY_ID: { action: "revoke", where: "Cloudflare R2 token (R2 is removed from the app, C23)" },
  R2_SECRET_ACCESS_KEY: { action: "revoke", where: "Cloudflare R2 token (R2 is removed from the app, C23)" },
  CRON_SECRET: { action: "rotate", where: "new random value (`openssl rand -hex 32`); bearer of /api/diag/error only" },
  JOBS_RUNNER_SECRET: { action: "rotate", where: "docs/runbooks/jobs.md section 3; production value must differ from CRON_SECRET and from staging" },
  RESEND_API_KEY: { action: "rotate", where: "Resend > API Keys: production key, sending access only" },
  RAZORPAY_KEY_SECRET: { action: "rotate", where: "Razorpay Dashboard (live keys only in production)" },
  RAZORPAY_WEBHOOK_SECRET: { action: "rotate", where: "Razorpay Dashboard > Webhooks (live webhook)" },
  TURNSTILE_SECRET_KEY: { action: "rotate", where: "Cloudflare Turnstile widget secret" },
  BACKUP_AGE_RECIPIENTS: { action: "none", where: "public age recipients, not secret" },
  NEXT_PUBLIC_SUPABASE_URL: { action: "none", where: "not a secret" },
  NEXT_PUBLIC_APP_URL: { action: "none", where: "not a secret" },
};

const SECRET_HINT = /(SECRET|TOKEN|KEY|PASSWORD|PASSWD|CREDENTIAL)/i;

/** Parse the stdout of a store CLI into names. Anything that is not a plain name is dropped without being kept. */
export function namesFromTable(text) {
  const names = new Set();
  let dropped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const first = line.split(/\s+/)[0];
    if (first.includes("=")) {
      throw new Error("input_looks_like_name_value_pairs");
    }
    if (NAME_RE.test(first) && first === first.toUpperCase()) names.add(first);
    else dropped++;
  }
  return { names: [...names].sort(), dropped };
}

/** One name per line; any `=` anywhere refuses the whole input. */
export function namesFromList(text) {
  if (/=/.test(text)) throw new Error("input_looks_like_name_value_pairs");
  const names = new Set();
  let dropped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (NAME_RE.test(line)) names.add(line);
    else dropped++;
  }
  return { names: [...names].sort(), dropped };
}

export function classify(name) {
  if (KNOWN[name]) return { ...KNOWN[name], known: true };
  if (SECRET_HINT.test(name)) return { action: "review", where: "unknown name that looks secret: decide rotate or remove", known: false };
  return { action: "none", where: "unknown name, not secret-looking: confirm", known: false };
}

export function renderChecklist(names, sourceNote) {
  const rows = names.map((n) => ({ n, ...classify(n) }));
  const order = { revoke: 0, rotate: 1, review: 2, none: 3 };
  rows.sort((a, b) => order[a.action] - order[b.action] || a.n.localeCompare(b.n));
  const out = [];
  out.push("# Secret rotation checklist (names only; no values were read)");
  out.push("");
  out.push(`Sources: ${sourceNote}. Names found: ${names.length}.`);
  out.push("Record dates and the smoke result in docs/ops/secret-rotation.md (names and dates only).");
  out.push("");
  out.push("| Done | Action | Name | Where |");
  out.push("|---|---|---|---|");
  for (const r of rows) out.push(`| [ ] | ${r.action} | \`${r.n}\` | ${r.where} |`);
  const missing = Object.keys(KNOWN).filter((k) => !names.includes(k) && KNOWN[k].action !== "none");
  out.push("");
  out.push("Known names NOT found in the sources (confirm each is unset everywhere, or check another store):");
  out.push(missing.length ? missing.map((m) => `- \`${m}\``).join("\n") : "- none");
  out.push("");
  out.push("Smoke check per rotated or revoked name: one call with the OLD value is rejected by its provider; the app works with the new value.");
  return out.join("\n");
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8", shell: false, timeout: 60000 });
  if (r.error || r.status !== 0) throw new Error("cli_failed");
  return r.stdout;
}

function parseArgs(argv) {
  const a = { vercel: false, gh: false, stdin: false, env: "production", ref: null, file: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--vercel") a.vercel = true;
    else if (k === "--github-secrets") a.gh = true;
    else if (k === "--stdin") a.stdin = true;
    else if (k === "--environment") a.env = argv[++i];
    else if (k === "--supabase-ref") a.ref = argv[++i];
    else if (k === "--names-file") a.file = argv[++i];
    else throw new Error("unknown_argument");
  }
  if (!["production", "preview", "development"].includes(a.env)) throw new Error("bad_environment");
  if (a.ref && !/^[a-z0-9]{20}$/.test(a.ref)) throw new Error("bad_project_ref");
  return a;
}

export function main(argv) {
  const a = parseArgs(argv);
  const found = new Set();
  const notes = [];
  if (a.file) {
    if (path.basename(a.file).startsWith(".env")) throw new Error("env_files_are_never_read");
    namesFromList(fs.readFileSync(a.file, "utf8")).names.forEach((n) => found.add(n));
    notes.push("names file");
  }
  if (a.stdin) {
    namesFromList(fs.readFileSync(0, "utf8")).names.forEach((n) => found.add(n));
    notes.push("stdin");
  }
  if (a.vercel) {
    namesFromTable(run("vercel", ["env", "ls", a.env])).names.forEach((n) => found.add(n));
    notes.push(`vercel (${a.env})`);
  }
  if (a.gh) {
    namesFromTable(run("gh", ["secret", "list"])).names.forEach((n) => found.add(n));
    notes.push("github secrets");
  }
  if (a.ref) {
    namesFromTable(run("supabase", ["secrets", "list", "--project-ref", a.ref])).names.forEach((n) => found.add(n));
    notes.push("supabase secrets");
  }
  if (!notes.length) throw new Error("no_source_given");
  return renderChecklist([...found].sort(), notes.join(", "));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    process.stdout.write(main(process.argv.slice(2)) + "\n");
  } catch (e) {
    // Only a fixed reason code is printed: never input text.
    const code = e instanceof Error && /^[a-z_]+$/.test(e.message) ? e.message : "refused";
    process.stderr.write(`secret-inventory refused: ${code}\n`);
    process.exit(2);
  }
}
