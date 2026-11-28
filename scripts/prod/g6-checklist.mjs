#!/usr/bin/env node
/**
 * G6 checklist generator (V2-15 15-06). Reads roadmap section 17.1 (UAT start) and prints one table row per line with its
 * kind (code-proved, PO action, PO decision), the runbook that covers it and the command that verifies it. It needs no
 * database and reads no secrets or environment files.
 *
 *   node scripts/prod/g6-checklist.mjs [--ci-run <github run id>] [--sha <commit>] [--verified <file.json>] [--out <file>]
 *
 * --verified: a JSON object { "<rule id>": "<text the PO pasted: IDs and dates only>" }. A line is "done" only when
 * its kind is code and a CI run id was given, or when the PO's verification text exists for its rule id. Everything
 * else stays "pending". The generator never marks a line done by itself and refuses verification text that looks like
 * a secret (long token-like strings, key prefixes) or an e-mail address.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ROADMAP = path.join(ROOT, "docs/v2/V2_MASTER_ROADMAP.md");

/** Rules map a 17.1 line (by a regex over its text) to how it is proved. First match wins. */
export const RULES = [
  { id: "sec-sev", re: /Security verification done/, kind: "code", runbook: "V2-14 14-VERIFICATION.md", verify: "open Critical/High count in the V2-14 report is 0" },
  { id: "secret-rotation", re: /Mandatory \(C49\)/, kind: "po", runbook: "docs/ops/secret-rotation.md", verify: "node scripts/prod/secret-inventory.mjs --vercel --github-secrets, then the smoke check per row" },
  { id: "api-v1", re: /ADR-0005 at go-live/, kind: "code", runbook: "15-01 production env schema", verify: "tests/prod/api-v1-404.spec.ts in CI" },
  { id: "headers", re: /Security headers \+ CSP/, kind: "code", runbook: "V2-14 evidence", verify: "security header tests in CI" },
  { id: "policies", re: /Privacy notice, Terms/, kind: "po", runbook: ".planning/PO-ACTIONS.md V2-15 step 11", verify: "open each public page on production; retention schedule approval in chat" },
  { id: "incident", re: /Incident runbook/, kind: "code", runbook: "docs/runbooks/incident.md, public/.well-known/security.txt", verify: "security.txt contact is not a placeholder (PO fills it)" },
  { id: "supabase-prod", re: /New production Supabase project/, kind: "po", runbook: "docs/runbooks/production-setup.md", verify: "production-setup.md verify block" },
  { id: "frontend", re: /Front end deployed by the PO/, kind: "po", runbook: "docs/runbooks/production-setup.md (Vercel)", verify: "readiness check against the production URL (PO runs)" },
  { id: "ft02", re: /FT-02 live for production/, kind: "po", runbook: "docs/ops/backup-restore.md (production section), docs/runbooks/restore-drill-aws.md", verify: "two ops.backup_runs rows ok, failure alert test issue seen" },
  { id: "upgrade-rb", re: /Upgrade runbook \(FT-08\)/, kind: "code", runbook: "docs/runbooks/free-tier-upgrade.md", verify: "runbook present; the PO puts the upgrade date on the calendar" },
  { id: "migrations", re: /Approval-gated migrations/, kind: "code", runbook: "docs/runbooks/production-migrate.md", verify: "production-migrate workflow rehearsal and from-scratch migration CI job" },
  { id: "scheduler", re: /Scheduler \(pg_cron\) live/, kind: "po", runbook: "docs/runbooks/alerts.md", verify: "node scripts/ops/alert-drill.mjs --print on production, then the pg_cron verify query" },
  { id: "observability", re: /Error tracking/, kind: "po", runbook: "docs/runbooks/uptime.md", verify: "two monitors green for 24 h (screenshot with no URLs that carry tokens)" },
  { id: "restore", re: /Restore drill passed/, kind: "po", runbook: "docs/runbooks/restore-drill.md", verify: "drill evidence JSON: RPO <= 12 h, RTO recorded, pgTAP green" },
  { id: "email", re: /SES production access/, kind: "decision", runbook: "docs/runbooks/email-production.md", verify: "PO decision 2026-11-13: Resend through UAT; this line is satisfied by Resend domain checks passing and a delivered signup code (SES moves to V2-16)" },
  { id: "razorpay-live", re: /Razorpay in \*\*live mode\*\*/, kind: "po", runbook: "docs/runbooks/razorpay-live.md", verify: "verify-webhook-delivery output with signature_valid true; or the comp fallback in writing" },
  { id: "mandate-live", re: /real ₹5 mandate/, kind: "po", runbook: "docs/runbooks/razorpay-live.md section 4", verify: "provider ids only in 15-LIVE-PAYMENTS-CHECKLIST.md" },
  { id: "mandate-pwa", re: /installed PWA/, kind: "po", runbook: ".planning/phases/15-production-readiness-uat-launch/15-DEVICE-RUN.md R12", verify: "scored by an isolated reviewer agent" },
  { id: "lifecycle", re: /Lifecycle transitions/, kind: "code", runbook: "V2-13b/13c evidence", verify: "staging time-travel specs in CI" },
  { id: "uat-campaign", re: /`uat` campaign/, kind: "po", runbook: "docs/runbooks/uat.md, docs/runbooks/uat-slip.md", verify: "campaign row exists, free_until set, code count equals clinic count (counts only)" },
  { id: "admin", re: /Platform admin bootstrapped/, kind: "po", runbook: "docs/runbooks/platform-admin-bootstrap.md", verify: "two aal2 factors enrolled; break-glass drill row in the audit log" },
  { id: "ai", re: /Vertex|AI shown as/, kind: "code", runbook: "V2-12 evidence", verify: "AI coming-soon and preview-label specs in CI" },
  { id: "release-criteria", re: /TEST_STRATEGY §9|Nightly lane green/, kind: "code", runbook: "phase-evidence.mjs output", verify: "nightly run ids, 7 consecutive green" },
  { id: "perf", re: /k6 at go-live load/, kind: "code", runbook: "15-05 nightly k6 and LHCI", verify: "nightly run ids" },
  { id: "devices", re: /Real-device checklist/, kind: "po", runbook: ".planning/phases/15-production-readiness-uat-launch/15-DEVICE-RUN.md", verify: "reviewer-agent score file over the PO's notes" },
  { id: "role-matrix", re: /Role matrix/, kind: "code", runbook: "V2-05..V2-08 authz tests; then the PO's own signup on production", verify: "PO completes owner signup with a code and a staff invite on production" },
  { id: "msg91", re: /MSG91 appointment-reminder/, kind: "po", runbook: "docs/runbooks/uat.md section 1", verify: "template approval status in MSG91; readiness output lists the real provider" },
  { id: "release-docs", re: /Release notes, an in-app help/, kind: "code", runbook: "docs/release-notes/v2.0.md, docs/uat/tester-guide.md, /help (15-06 code part)", verify: "files present; /help e2e in CI" },
  { id: "go-no-go", re: /UAT clinics, success metrics/, kind: "decision", runbook: "this checklist", verify: "PO records go or no-go in chat" },
];

const SECRETISH = [/[A-Za-z0-9_\-]{32,}/, /\b(rzp_(live|test)_|sk_|eyJ|AKIA|re_)[A-Za-z0-9]/, /[^\s@]+@[^\s@]+\.[^\s@]+/];

export function refuseSecretish(text) {
  return SECRETISH.some((re) => re.test(text));
}

export function parseSection(md) {
  const start = md.indexOf("### 17.1 UAT start (G6)");
  const end = md.indexOf("### 17.2", start);
  if (start < 0 || end < 0) throw new Error("section_17_1_not_found");
  const lines = md.slice(start, end).split(/\r?\n/);
  const items = [];
  let group = "";
  for (const l of lines) {
    const g = /^\*\*(.+)\*\*\s*$/.exec(l.trim());
    if (g) group = g[1];
    const m = /^- \[[ x]\]\s+(.*)$/.exec(l);
    if (m) items.push({ group, text: m[1] });
  }
  return items;
}

export function classify(item) {
  const rule = RULES.find((r) => r.re.test(item.text));
  return rule ?? { id: "unmapped", kind: "po", runbook: "none yet", verify: "add a rule in scripts/prod/g6-checklist.mjs" };
}

export function render(items, opts) {
  const verified = opts.verified ?? {};
  for (const v of Object.values(verified)) {
    if (refuseSecretish(String(v))) throw new Error("verification_text_looks_secret");
  }
  const out = [];
  out.push("# G6 checklist (UAT start), generated");
  out.push("");
  out.push(`Generated by scripts/prod/g6-checklist.mjs from roadmap section 17.1. Commit: ${opts.sha ?? "not given"}. CI run: ${opts.ciRun ? `https://github.com/<owner>/<repo>/actions/runs/${opts.ciRun}` : "not given"}.`);
  out.push("A line is done only with CI evidence (kind code) or the PO's pasted verification. G6 is the PO's go/no-go.");
  out.push("");
  out.push("| # | Group | Line | Kind | Status | Runbook | Verify | PO verification |");
  out.push("|---|---|---|---|---|---|---|---|");
  let i = 0;
  const counts = { done: 0, pending: 0 };
  for (const it of items) {
    i++;
    const r = classify(it);
    const pasted = verified[r.id];
    let status = "pending";
    if (pasted) status = "done (PO verified)";
    else if (r.kind === "code" && opts.ciRun) status = "done (CI)";
    if (status.startsWith("done")) counts.done++;
    else counts.pending++;
    const cell = (s) => String(s).replace(/\|/g, "/").replace(/\s+/g, " ").slice(0, 160);
    out.push(`| ${i} | ${cell(it.group)} | ${cell(it.text)} | ${r.kind} | ${status} | ${cell(r.runbook)} | ${cell(r.verify)} | ${pasted ? cell(pasted) : ""} |`);
  }
  out.push("");
  out.push(`Totals: ${counts.done} done, ${counts.pending} pending of ${items.length}.`);
  return out.join("\n");
}

export function main(argv) {
  const o = {};
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    if (a === "--ci-run") o.ciRun = argv[++k];
    else if (a === "--sha") o.sha = argv[++k];
    else if (a === "--verified") o.verifiedFile = argv[++k];
    else if (a === "--out") o.out = argv[++k];
    else throw new Error("unknown_argument");
  }
  if (o.ciRun && !/^\d{6,15}$/.test(o.ciRun)) throw new Error("bad_ci_run");
  if (o.sha && !/^[0-9a-f]{7,40}$/.test(o.sha)) throw new Error("bad_sha");
  if (o.verifiedFile && path.basename(o.verifiedFile).startsWith(".env")) throw new Error("env_files_are_never_read");
  const verified = o.verifiedFile ? JSON.parse(fs.readFileSync(o.verifiedFile, "utf8")) : {};
  const md = render(parseSection(fs.readFileSync(ROADMAP, "utf8")), { ciRun: o.ciRun, sha: o.sha, verified });
  if (o.out) fs.writeFileSync(o.out, md + "\n");
  return md;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    process.stdout.write(main(process.argv.slice(2)) + "\n");
  } catch (e) {
    const code = e instanceof Error && /^[a-z0-9_]+$/.test(e.message) ? e.message : "refused";
    process.stderr.write(`g6-checklist refused: ${code}\n`);
    process.exit(2);
  }
}
