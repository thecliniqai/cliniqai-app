/**
 * Ops report checker (V2-04 04-06; ruling R-28; threats T-04-10, T-04-17). Validates the JSON that
 * `ops.report_all(p_hours)` returns (written by `scripts/ops/ops-report.mjs` in `.github/workflows/ops-report.yml`, or
 * pasted from the SQL editor) and reports the staging acceptance requirements as data.
 *
 *   npx tsx scripts/ops/check-ops-report.ts <file> [--require lag,heartbeat,quota,alert-drill,backups] [--out <file>]
 *
 * 1. Schema: exactly the report's keys at every level (strict), each value of its type and shape: counts, seconds,
 *    ISO-8601 UTC timestamps, job kinds, rule names, status words, codes. A key the report does not define fails.
 * 2. PII: every string and key is scanned for phone-, email- and UUID-shaped text. A hit fails, naming the path and the
 *    rule, never the value. (The schema already refuses free text; this is the independent second check.)
 * 3. Requirements (data, reported every run):
 *      lag          p95 < 120 s with >= 100 samples (roadmap "queue lag p95 < 2 min in staging");
 *      heartbeat    largest gap <= 6 h 15 min, over >= 24 h of heartbeats (FT-03);
 *      quota        a snapshot with database, Storage and MAU usage and their levels (FT-04);
 *      alert-drill  a `dead_letter` alert that was emailed (notified, provider id present) (04-P12);
 *      backups      >= 2 ok staging backups in every full IST day of the window (FT-02).
 *
 * The summary (stdout, and `--out`) holds verdicts, counts and paths only. Exit 0 = schema and PII clean and every
 * `--require`d requirement passes; 1 = a schema or PII violation, or a required requirement fails; 2 = usage or an
 * unreadable file. The workflow runs it without `--require` (acceptance results are data, not job failures).
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

export const REQUIREMENTS = ["lag", "heartbeat", "quota", "alert-drill", "backups"] as const;
export type Requirement = (typeof REQUIREMENTS)[number];

/** Acceptance thresholds (roadmap V2-04; R-5, FT-03). */
export const LAG_P95_MAX_SECONDS = 120;
export const LAG_MIN_SAMPLES = 100;
export const HEARTBEAT_MAX_GAP_SECONDS = 6 * 3600 + 15 * 60;
export const HEARTBEAT_MIN_COVERED_SECONDS = 24 * 3600;
export const BACKUPS_MIN_OK_PER_IST_DAY = 2;

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const iso = z.string().regex(ISO);
const count = z.number().int().nonnegative();
const seconds = z.number().nonnegative().nullable();
const kind = z.string().max(64).regex(/^[a-z]+(\.[a-z_]+)+$/);
const rule = z.string().regex(/^[a-z][a-z0-9_]{1,62}$/);
const code = z.string().max(64).regex(/^[a-z][a-z0-9_]*$/);
const level = z.enum(["ok", "upgrade_trigger", "critical", "unknown"]);

const REPORT = z
  .object({
    report_version: z.literal(1),
    generated_at: iso,
    window_hours: z.number().int().min(1).max(336),
    jobs: z
      .object({
        by_kind_status: z.array(
          z.object({ kind, status: z.enum(["pending", "running", "done", "dead", "cancelled"]), count }).strict(),
        ),
        lag: z.object({ samples: count, p50_seconds: seconds, p95_seconds: seconds, max_seconds: seconds }).strict(),
      })
      .strict(),
    dead_last_24h: z.object({ total: count, by_kind: z.array(z.object({ kind, count }).strict()) }).strict(),
    runner: z
      .object({
        configured: z.boolean(),
        runs: count,
        ok_runs: count,
        largest_ok_gap_seconds: seconds,
        last_ok_age_seconds: seconds,
      })
      .strict(),
    alerts: z
      .array(
        z
          .object({
            rule,
            severity: z.enum(["critical", "warn", "info"]),
            status: z.enum(["open", "resolved"]),
            opened: iso,
            last_seen: iso,
            resolved_at: iso.nullable(),
            count: z.number().int().min(1),
            notified: z.boolean(),
            notify_count: count,
            notify_tries: count,
            unsent: z.boolean(),
            provider_id_present: z.boolean(),
          })
          .strict(),
      )
      .max(100),
    heartbeats: z
      .object({
        count,
        at: z.array(iso).max(500),
        largest_gap_seconds: seconds,
        covered_seconds: seconds,
        last_at: iso.nullable(),
      })
      .strict(),
    quota: z
      .object({
        at: iso,
        plan: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/),
        db_bytes: count,
        storage_bytes: count,
        mau_estimate: count,
        limits: z
          .object({ db_bytes: z.number().positive(), storage_bytes: z.number().positive(), mau: z.number().positive() })
          .partial()
          .strict(),
        levels: z.object({ db_bytes: level, storage_bytes: level, mau: level }).strict(),
      })
      .strict()
      .nullable(),
    backups: z
      .array(
        z
          .object({
            environment: z.enum(["local", "staging", "production"]),
            started_at: iso,
            finished_at: iso.nullable(),
            status: z.enum(["ok", "failed"]),
            archive_bytes: count.nullable(),
            duration_s: count.nullable(),
            error_code: code.nullable(),
          })
          .strict(),
      )
      .max(200),
    tables: z
      .object({
        jobs: count,
        job_runner_runs: count,
        alerts: count,
        heartbeats: count,
        quota_snapshots: count,
        backup_runs: count,
        inbound_webhook_events: count,
        error_events: count,
      })
      .strict(),
  })
  .strict();

export type OpsReport = z.infer<typeof REPORT>;

/** PII shapes searched in every string and key (T-04-10, T-04-17). Indian and international phone numbers: 10+ digits. */
const PII_RULES: Array<[string, RegExp]> = [
  ["phone", /(?:\+?\d[\s().-]?){9,}\d/],
  ["email", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
  ["uuid", /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i],
];

/** `path: rule` for every PII-shaped string or key in `value` (never the value itself). */
export function piiProblems(value: unknown, at = "$"): string[] {
  const out: string[] = [];
  const scan = (text: string, where: string) => {
    for (const [name, re] of PII_RULES) if (re.test(text)) out.push(`${where}: ${name}-shaped string`);
  };
  if (typeof value === "string") scan(value, at);
  else if (Array.isArray(value)) value.forEach((v, i) => out.push(...piiProblems(v, `${at}[${i}]`)));
  else if (value !== null && typeof value === "object") {
    for (const [key, v] of Object.entries(value)) {
      scan(key, `${at} (key)`);
      // A key is never echoed: a PII-shaped key is named by its position only.
      const safeKey = /^[a-z][a-z0-9_]{0,63}$/.test(key) ? key : "<key>";
      out.push(...piiProblems(v, `${at}.${safeKey}`));
    }
  }
  return out;
}

export interface RequirementResult {
  pass: boolean;
  detail: Record<string, number | boolean | null>;
}

const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 3600 * 1000;

/** The IST calendar day (as a UTC-midnight epoch of that date) of an instant. */
function istDay(ms: number): number {
  return Math.floor((ms + IST_OFFSET_MS) / DAY_MS) * DAY_MS;
}

export function evaluateRequirements(report: OpsReport): Record<Requirement, RequirementResult> {
  const lag = report.jobs.lag;
  const hb = report.heartbeats;
  const generated = Date.parse(report.generated_at);
  const since = generated - report.window_hours * 3600 * 1000;

  // Full IST days inside [since, generated): the first day starts at or after `since`, the last ends by `generated`.
  const days: number[] = [];
  for (let d = istDay(since) + (istDay(since) - IST_OFFSET_MS < since ? DAY_MS : 0); d - IST_OFFSET_MS + DAY_MS <= generated; d += DAY_MS) {
    days.push(d);
  }
  const okPerDay = days.map(
    (d) =>
      report.backups.filter((b) => b.environment === "staging" && b.status === "ok" && istDay(Date.parse(b.started_at)) === d).length,
  );
  const minPerDay = okPerDay.length ? Math.min(...okPerDay) : null;

  const drill = report.alerts.find((a) => a.rule === "dead_letter" && a.notified && a.provider_id_present);

  return {
    lag: {
      pass: lag.samples >= LAG_MIN_SAMPLES && lag.p95_seconds !== null && lag.p95_seconds < LAG_P95_MAX_SECONDS,
      detail: { samples: lag.samples, p95_seconds: lag.p95_seconds, min_samples: LAG_MIN_SAMPLES, max_p95_seconds: LAG_P95_MAX_SECONDS },
    },
    heartbeat: {
      pass:
        hb.largest_gap_seconds !== null &&
        hb.covered_seconds !== null &&
        hb.covered_seconds >= HEARTBEAT_MIN_COVERED_SECONDS &&
        hb.largest_gap_seconds <= HEARTBEAT_MAX_GAP_SECONDS,
      detail: {
        heartbeats: hb.count,
        largest_gap_seconds: hb.largest_gap_seconds,
        covered_seconds: hb.covered_seconds,
        max_gap_seconds: HEARTBEAT_MAX_GAP_SECONDS,
        min_covered_seconds: HEARTBEAT_MIN_COVERED_SECONDS,
      },
    },
    quota: {
      pass: report.quota !== null,
      detail: {
        snapshot: report.quota !== null,
        db_bytes: report.quota?.db_bytes ?? null,
        storage_bytes: report.quota?.storage_bytes ?? null,
        mau_estimate: report.quota?.mau_estimate ?? null,
      },
    },
    "alert-drill": {
      pass: drill !== undefined,
      detail: {
        dead_letter_alerts: report.alerts.filter((a) => a.rule === "dead_letter").length,
        notified_with_provider_id: drill !== undefined,
      },
    },
    backups: {
      pass: okPerDay.length > 0 && okPerDay.every((n) => n >= BACKUPS_MIN_OK_PER_IST_DAY),
      detail: { full_ist_days: okPerDay.length, min_ok_per_day: minPerDay, required_per_day: BACKUPS_MIN_OK_PER_IST_DAY },
    },
  };
}

export interface CheckResult {
  ok: boolean;
  schema: { ok: boolean; problems: string[] };
  pii: { ok: boolean; problems: string[] };
  requirements: Record<Requirement, RequirementResult> | null;
  required: Requirement[];
  failedRequired: Requirement[];
}

/** Checks a parsed report. `ok` = schema and PII clean and every required requirement passes. */
export function checkOpsReport(input: unknown, required: Requirement[] = []): CheckResult {
  const pii = piiProblems(input);
  const parsed = REPORT.safeParse(input);
  // zod issues name the path and the expectation; the received value is never part of the message.
  const schemaProblems = parsed.success
    ? []
    : parsed.error.issues.slice(0, 50).map((i) => `$${i.path.map((p) => (typeof p === "number" ? `[${p}]` : `.${/^[a-z][a-z0-9_]{0,63}$/.test(String(p)) ? p : "<key>"}`)).join("")}: ${i.code}`);
  const requirements = parsed.success ? evaluateRequirements(parsed.data) : null;
  const failedRequired = required.filter((r) => !requirements || !requirements[r].pass);
  return {
    ok: parsed.success && pii.length === 0 && failedRequired.length === 0,
    schema: { ok: parsed.success, problems: schemaProblems },
    pii: { ok: pii.length === 0, problems: pii },
    requirements,
    required,
    failedRequired,
  };
}

/** Parses the argument list. Returns an error message for usage problems. */
export function parseArgs(argv: string[]): { file: string; required: Requirement[]; out?: string } | { error: string } {
  let file: string | undefined;
  let out: string | undefined;
  let required: Requirement[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--require") {
      const list = (argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const unknown = list.filter((r) => !(REQUIREMENTS as readonly string[]).includes(r));
      if (list.length === 0 || unknown.length) return { error: `--require takes a comma list of ${REQUIREMENTS.join(", ")}` };
      required = list as Requirement[];
    } else if (a === "--out") {
      out = argv[++i];
      if (!out) return { error: "--out takes a file" };
    } else if (a.startsWith("-") || file !== undefined) {
      return { error: `unexpected argument` };
    } else file = a;
  }
  if (!file) return { error: "missing <file>" };
  return { file, required, out };
}

/** Reads `file` (the report as one JSON object; the SQL editor's `[{"report_all": {...}}]` export is unwrapped). */
export function readReport(file: string): unknown {
  const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (Array.isArray(parsed) && parsed.length === 1 && parsed[0] && typeof parsed[0] === "object") {
    const values = Object.values(parsed[0] as Record<string, unknown>);
    if (values.length === 1 && values[0] && typeof values[0] === "object") return values[0];
  }
  return parsed;
}

export function main(argv: string[]): number {
  const args = parseArgs(argv);
  if ("error" in args) {
    console.error(`check-ops-report: ${args.error}`);
    console.error("usage: npx tsx scripts/ops/check-ops-report.ts <file> [--require lag,heartbeat,quota,alert-drill,backups] [--out <file>]");
    return 2;
  }
  let report: unknown;
  try {
    if (!fs.existsSync(args.file)) throw new Error("missing");
    report = readReport(args.file);
  } catch (err) {
    if (err instanceof SyntaxError) {
      const result = { ok: false, schema: { ok: false, problems: ["$: not JSON"] }, pii: { ok: true, problems: [] }, requirements: null };
      console.log(JSON.stringify(result, null, 2));
      return 1;
    }
    console.error(`check-ops-report: cannot read ${path.basename(args.file)}`);
    return 2;
  }
  const result = checkOpsReport(report, args.required);
  const text = JSON.stringify(result, null, 2);
  if (args.out) fs.writeFileSync(args.out, `${text}\n`);
  console.log(text);
  if (!result.schema.ok) console.error(`check-ops-report: FAIL schema (${result.schema.problems.length} problem(s))`);
  if (!result.pii.ok) console.error(`check-ops-report: FAIL pii (${result.pii.problems.length} problem(s))`);
  for (const r of result.failedRequired) console.error(`check-ops-report: FAIL required ${r}`);
  if (result.ok) console.error(`check-ops-report: PASS${args.required.length ? ` (required: ${args.required.join(", ")})` : ""}`);
  return result.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(main(process.argv.slice(2)));
}
