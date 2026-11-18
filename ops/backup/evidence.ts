/**
 * Backup evidence (V2-04 04-05a; FT-02 acceptance 5, ruling R-28; threat T-04-11).
 *
 * Turns a bucket listing (`aws s3api list-objects-v2 --output json`, run by the staging backup workflow with its R2
 * token right after the upload) into the `backup-evidence` artifact: object keys, sizes and timestamps only (the
 * archives are age-encrypted; nothing is downloaded). Verdicts:
 *   twice_daily_ok      each of the last N full IST days has an archive in 02:00–03:30 and in 14:00–15:30 IST;
 *   keys_ok             every object under the prefix is `<env>/<UTC yyyy-mm-ddTHHMMSSZ>.tar.age` with size > 0
 *                       (names carry no tenant or patient data);
 *   retention_ok        no object older than 31 days (the bucket's 30-day lifecycle rule works);
 *   failed_run_alerted  (only with --runs/--alert-runs, Claude after 04-P11) a failed "forced failure drill" run of
 *                       backup.yml followed by a successful backup-alert.yml run (the issue was opened/updated).
 *
 *   npx tsx ops/backup/evidence.ts --listing <list-objects-v2.json> [--prefix staging/] [--days 2]
 *     [--runs <gh run list --workflow backup.yml --json …>] [--alert-runs <gh run list --workflow backup-alert.yml …>]
 *     --out backup-evidence.json
 *   npx tsx ops/backup/evidence.ts --check <file> [--require v1,v2,...]
 *     re-validates a downloaded artifact: allowed keys only, verdicts recomputed from the recorded data and equal to
 *     the recorded ones, the required verdicts (default: all) true. Exit 0 pass, 1 fail, 2 usage.
 * `gh run list` JSON fields used: databaseId, conclusion, createdAt, displayTitle.
 */
import fs from "node:fs";
import path from "node:path";

export const VERDICTS = ["twice_daily_ok", "keys_ok", "retention_ok", "failed_run_alerted"] as const;
export type Verdict = (typeof VERDICTS)[number];

const IST_OFFSET_MIN = 330;
/** IST windows (minutes after midnight) in which the 02:00 and 14:00 runs must land an archive. */
export const WINDOWS = [
  { name: "02:00", from: 120, to: 210 },
  { name: "14:00", from: 840, to: 930 },
] as const;
export const RETENTION_MAX_DAYS = 31;
/** The backup workflow's run name for the failed-run drill (`run-name` in .github/workflows/backup.yml). */
export const DRILL_TITLE = "Staging backup (forced failure drill)";
const KEY = /^[a-z0-9-]+\/\d{4}-\d{2}-\d{2}T\d{6}Z\.tar\.age$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export interface ObjectEntry {
  key: string;
  size: number;
  last_modified: string;
}
export interface RunEntry {
  id: number;
  conclusion: string;
  created_at: string;
  drill: boolean;
}
export interface Evidence {
  format_version: 1;
  kind: "backup-evidence";
  generated_at: string;
  prefix: string;
  days_checked: string[];
  objects: ObjectEntry[];
  backup_runs: RunEntry[] | null;
  alert_runs: RunEntry[] | null;
  verdicts: Record<Verdict, boolean>;
}

/** The `n` full IST calendar days before `now`'s IST day, oldest first (yyyy-mm-dd). */
export function fullIstDays(now: Date, n: number): string[] {
  const ist = new Date(now.getTime() + IST_OFFSET_MIN * 60_000);
  const days: string[] = [];
  for (let i = n; i >= 1; i--) {
    days.push(new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - i)).toISOString().slice(0, 10));
  }
  return days;
}

function istDayAndMinute(iso: string): { day: string; minute: number } {
  const ist = new Date(Date.parse(iso) + IST_OFFSET_MIN * 60_000);
  return { day: ist.toISOString().slice(0, 10), minute: ist.getUTCHours() * 60 + ist.getUTCMinutes() };
}

export function twiceDailyOk(objects: ObjectEntry[], days: string[], prefix: string): boolean {
  if (days.length === 0) return false;
  return days.every((day) =>
    WINDOWS.every((w) =>
      objects.some((o) => {
        if (!o.key.startsWith(prefix) || !KEY.test(o.key) || o.size <= 0) return false;
        const t = istDayAndMinute(o.last_modified);
        return t.day === day && t.minute >= w.from && t.minute <= w.to;
      }),
    ),
  );
}

export function computeVerdicts(e: Pick<Evidence, "objects" | "days_checked" | "prefix" | "generated_at" | "backup_runs" | "alert_runs">): Record<Verdict, boolean> {
  const now = Date.parse(e.generated_at);
  const drillFailures = (e.backup_runs ?? []).filter((r) => r.drill && r.conclusion === "failure");
  return {
    twice_daily_ok: twiceDailyOk(e.objects, e.days_checked, e.prefix),
    keys_ok: e.objects.every((o) => o.key.startsWith(e.prefix) && KEY.test(o.key) && o.size > 0),
    retention_ok: e.objects.every((o) => now - Date.parse(o.last_modified) <= RETENTION_MAX_DAYS * 86_400_000),
    failed_run_alerted: drillFailures.some((f) =>
      (e.alert_runs ?? []).some((a) => a.conclusion === "success" && Date.parse(a.created_at) >= Date.parse(f.created_at)),
    ),
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any -- CLI JSON input, narrowed field by field. */
export function objectsFromListing(listing: any): ObjectEntry[] {
  return (listing?.Contents ?? []).map((c: any) => ({
    key: String(c.Key),
    size: Number(c.Size),
    last_modified: new Date(c.LastModified).toISOString(),
  }));
}

export function runsFromGh(runs: any): RunEntry[] {
  return (Array.isArray(runs) ? runs : []).map((r: any) => ({
    id: Number(r.databaseId),
    conclusion: String(r.conclusion ?? ""),
    created_at: new Date(r.createdAt).toISOString(),
    drill: r.displayTitle === DRILL_TITLE,
  }));
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function buildEvidence(input: {
  listing: unknown;
  prefix: string;
  days: number;
  now: Date;
  runs?: unknown;
  alertRuns?: unknown;
}): Evidence {
  const base = {
    generated_at: input.now.toISOString(),
    prefix: input.prefix,
    days_checked: fullIstDays(input.now, input.days),
    objects: objectsFromListing(input.listing).filter((o) => o.key.startsWith(input.prefix)),
    backup_runs: input.runs === undefined ? null : runsFromGh(input.runs),
    alert_runs: input.alertRuns === undefined ? null : runsFromGh(input.alertRuns),
  };
  return { format_version: 1, kind: "backup-evidence", ...base, verdicts: computeVerdicts(base) };
}

const ALLOWED: Record<string, readonly string[]> = {
  "": ["format_version", "kind", "generated_at", "prefix", "days_checked", "objects", "backup_runs", "alert_runs", "verdicts"],
  "objects[]": ["key", "size", "last_modified"],
  "backup_runs[]": ["id", "conclusion", "created_at", "drill"],
  "alert_runs[]": ["id", "conclusion", "created_at", "drill"],
  verdicts: [...VERDICTS],
};

function keyProblems(value: unknown, at: string, problems: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) keyProblems(item, `${at}[]`, problems);
    return;
  }
  if (!value || typeof value !== "object") return;
  const allowed = ALLOWED[at];
  if (!allowed) {
    problems.push(`${at || "(root)"}: unexpected object`);
    return;
  }
  for (const k of Object.keys(value)) {
    if (!allowed.includes(k)) problems.push(`${at ? `${at}.` : ""}${k} is not an allowed key`);
    else keyProblems((value as Record<string, unknown>)[k], at ? `${at}.${k}` : k, problems);
  }
}

export function checkEvidence(evidence: unknown, require: readonly Verdict[] = VERDICTS): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return { ok: false, problems: ["not a JSON object"] };
  const e = evidence as Evidence;
  keyProblems(e, "", problems);
  if (e.format_version !== 1 || e.kind !== "backup-evidence") problems.push("not a backup-evidence v1 file");
  if (problems.length) return { ok: false, problems };
  if (!ISO.test(e.generated_at)) problems.push("generated_at is not an ISO UTC timestamp");
  for (const o of e.objects) {
    if (typeof o.key !== "string" || !KEY.test(o.key)) problems.push("an object key does not have the <env>/<timestamp>.tar.age shape");
  }
  if (problems.length) return { ok: false, problems };
  const recomputed = computeVerdicts(e);
  for (const v of VERDICTS) if (recomputed[v] !== e.verdicts?.[v]) problems.push(`verdict ${v} does not match the recorded data`);
  for (const v of require) if (recomputed[v] !== true) problems.push(`verdict ${v} is false`);
  return { ok: problems.length === 0, problems };
}

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i > -1 ? argv[i + 1] : undefined;
}

const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(file, "utf8"));

function main(argv: string[]): number {
  const checkFile = arg(argv, "--check");
  if (checkFile) {
    const req = arg(argv, "--require");
    const required = (req ? req.split(",").map((s) => s.trim()) : [...VERDICTS]) as Verdict[];
    if (required.some((v) => !VERDICTS.includes(v))) {
      process.stderr.write(`usage: --require takes a comma list of ${VERDICTS.join(", ")}\n`);
      return 2;
    }
    let parsed: unknown;
    try {
      parsed = readJson(checkFile);
    } catch {
      process.stderr.write("evidence: unreadable or invalid JSON\n");
      return 2;
    }
    const { ok, problems } = checkEvidence(parsed, required);
    const e = parsed as Evidence;
    if (e?.verdicts) process.stdout.write(`| verdict | value |\n|---|---|\n${VERDICTS.map((v) => `| ${v} | ${e.verdicts[v]} |`).join("\n")}\n`);
    process.stdout.write(ok ? "evidence: PASS\n" : `evidence: FAIL\n${problems.map((p) => `  - ${p}`).join("\n")}\n`);
    return ok ? 0 : 1;
  }

  const listing = arg(argv, "--listing");
  const out = arg(argv, "--out");
  if (!listing || !out) {
    process.stderr.write("usage: evidence.ts --listing <list-objects-v2.json> [--prefix staging/] [--days 2] [--runs f] [--alert-runs f] --out <f>\n");
    return 2;
  }
  const runs = arg(argv, "--runs");
  const alertRuns = arg(argv, "--alert-runs");
  const evidence = buildEvidence({
    listing: readJson(listing),
    prefix: arg(argv, "--prefix") ?? "staging/",
    days: Number(arg(argv, "--days") ?? 2),
    now: new Date(),
    runs: runs ? readJson(runs) : undefined,
    alertRuns: alertRuns ? readJson(alertRuns) : undefined,
  });
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(evidence, null, 2) + "\n");
  process.stdout.write(`evidence: wrote ${path.basename(out)} (${evidence.objects.length} objects)\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  process.exitCode = main(process.argv.slice(2));
}
