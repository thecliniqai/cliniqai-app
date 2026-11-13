#!/usr/bin/env bash
# FT-02 backup: database dump + Storage sync -> manifest -> age (two recipients) -> S3-compatible bucket
# (V2-04 04-05a; R-3, R-31; PO decision 2026-11-13: staging backups go to Cloudflare R2, AWS Mumbai at go-live).
#
# Runs in the GitHub Actions workflow .github/workflows/backup.yml (Environment `staging-backup`, feature/v2 only, R-48),
# and locally (BACKUP_ENV=local) against the local Supabase stack with its Storage S3 endpoint as the bucket stand-in.
# Every S3 call (source Storage sync and target upload) uses the digest-pinned AWS CLI image (ops/bin/aws-docker.sh).
# Never prints a URL, a key or a password: failures name the variable, tool output passes through a URL redactor.
#
# Usage: ops/backup/backup.sh [--check-config]
#   --check-config  validate the environment below and exit (0 ok, 2 refused); connects to nothing.
#
# Environment (target names as in environment.txt.example §E)
#   BACKUP_ENV                  local | staging | production
#   DB_URL                      Postgres URL (local: loopback; hosted: the Supabase session pooler re-serialised by
#                               scripts/staging/target-guard.mjs without its password, which comes as PGPASSWORD)
#   PGPASSWORD / PGSSLMODE      optional; passed to pg_dump (Supabase CLI) and psql by name, never in argv
#   BACKUP_AGE_RECIPIENTS       >= 2 distinct age1... public keys, space or comma separated (primary + break-glass, R-3)
#   BACKUP_S3_ENDPOINT          target S3 endpoint (local: loopback stand-in; hosted: https, e.g. the R2 account endpoint)
#   BACKUP_S3_BUCKET            target bucket
#   BACKUP_S3_ACCESS_KEY_ID / BACKUP_S3_SECRET_ACCESS_KEY   target credentials (R2: Object Read & Write on that bucket)
#   BACKUP_S3_REGION            optional (default: "auto" hosted, as R2 expects; STORAGE_S3_REGION locally)
#   BACKUP_S3_PREFIX            object key prefix (default "<BACKUP_ENV>/")
#   STORAGE_S3_ENDPOINT / STORAGE_S3_REGION / STORAGE_S3_KEY_ID / STORAGE_S3_SECRET
#                               the source project's Supabase Storage S3 protocol (read by `aws s3 sync`)
#   SUPABASE_WORKDIR            local only: the directory holding supabase/config.toml (default: this repository)
#   FORCE_FAIL=1                failed-run drill (04-P11): exit 64 after validation, before any connection
#   AGE_BIN                     optional path to `age` (else PATH, else ops/bin/install-age.sh)
#   BACKUP_DIGEST_OUT           optional file for {object_key, archive_sha256, archive_bytes} (04-07c, M-BACKUPAUTH);
#                               backup.yml uploads it in the `backup-evidence` artifact. With GITHUB_STEP_SUMMARY set,
#                               the same digest is appended to the job summary. Both are records the R2 token cannot
#                               write; a restore passes the digest as `ops/restore-drill/run.sh --expect-sha256`.
#
# Exit codes: 0 ok; 2 configuration refused; 3 backup uploaded but the job runner is stale (dead-man, R-41); 64 forced
# failure; any other non-zero = a failed step (a best-effort `failed` ops.backup_runs row is written first).
set -euo pipefail
umask 077

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="$(cd "$HERE/../bin" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
# shellcheck source=../bin/pins.env
source "$BIN/pins.env"

MODE=run
case "${1:-}" in
  "") ;;
  --check-config) MODE=check ;;
  *) echo "usage: backup.sh [--check-config]" >&2; exit 2 ;;
esac

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
refuse() { echo "backup: configuration refused: $*" >&2; exit 2; }
redact() { sed -E 's#[A-Za-z][A-Za-z0-9+.-]*://[^[:space:]"'"'"']+#<url redacted>#g'; }
lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# Host of a URL (scheme and userinfo removed; brackets of an IPv6 literal removed), lower-cased.
url_host() {
  local rest="${1#*://}"
  rest="${rest%%/*}"
  rest="${rest%%\?*}"
  rest="${rest%%#*}"
  rest="${rest##*@}"
  if [[ "$rest" == \[* ]]; then
    rest="${rest#\[}"
    rest="${rest%%\]*}"
  else
    rest="${rest%%:*}"
  fi
  lower "$rest"
}

# Loopback or any-address forms (also host.docker.internal, which reaches the developer's machine).
is_local_host() {
  local h="${1%.}"
  case "$h" in
    localhost | *.localhost | ::1 | :: | 0.0.0.0 | host.docker.internal | 0:0:0:0:0:0:0:1) return 0 ;;
  esac
  [[ "$h" =~ ^127\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && return 0
  [[ "$h" =~ ^::ffff:(127\.|7f) ]] && return 0
  return 1
}

has_scheme() { [[ "$1" =~ ^[A-Za-z][A-Za-z0-9+.-]*:// ]]; }

# ---------------------------------------------------------------------------------------------------------------------
# 1. Validate (no connection, no tool call).
# ---------------------------------------------------------------------------------------------------------------------
BACKUP_ENV="${BACKUP_ENV:-}"
case "$BACKUP_ENV" in
  local | staging | production) ;;
  *) refuse "BACKUP_ENV must be local, staging or production" ;;
esac

[[ -n "${DB_URL:-}" ]] || refuse "DB_URL is not set"
[[ "$DB_URL" =~ ^postgres(ql)?:// ]] || refuse "DB_URL must use the postgres or postgresql scheme"
db_host="$(url_host "$DB_URL")"
[[ -n "$db_host" ]] || refuse "DB_URL has no host"

[[ -n "${BACKUP_S3_BUCKET:-}" ]] || refuse "BACKUP_S3_BUCKET is not set"
[[ "$BACKUP_S3_BUCKET" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || refuse "BACKUP_S3_BUCKET is not a valid bucket name"
BACKUP_S3_PREFIX="${BACKUP_S3_PREFIX:-${BACKUP_ENV}/}"
[[ "$BACKUP_S3_PREFIX" =~ ^[a-z0-9-]+/$ ]] || refuse "BACKUP_S3_PREFIX must look like <name>/"

for name in BACKUP_S3_ENDPOINT BACKUP_S3_ACCESS_KEY_ID BACKUP_S3_SECRET_ACCESS_KEY \
  STORAGE_S3_ENDPOINT STORAGE_S3_REGION STORAGE_S3_KEY_ID STORAGE_S3_SECRET; do
  [[ -n "${!name:-}" ]] || refuse "$name is not set"
done
has_scheme "$BACKUP_S3_ENDPOINT" || refuse "BACKUP_S3_ENDPOINT must be a URL"
has_scheme "$STORAGE_S3_ENDPOINT" || refuse "STORAGE_S3_ENDPOINT must be a URL"
target_host="$(url_host "$BACKUP_S3_ENDPOINT")"
storage_host="$(url_host "$STORAGE_S3_ENDPOINT")"

if [[ "$BACKUP_ENV" == "local" ]]; then
  is_local_host "$db_host" && [[ "$db_host" != "host.docker.internal" ]] || refuse "DB_URL must point at a loopback host when BACKUP_ENV=local"
  is_local_host "$target_host" || refuse "BACKUP_S3_ENDPOINT must point at a loopback host when BACKUP_ENV=local (the local stand-in)"
  is_local_host "$storage_host" || refuse "STORAGE_S3_ENDPOINT must point at a loopback host when BACKUP_ENV=local"
  BACKUP_S3_REGION="${BACKUP_S3_REGION:-$STORAGE_S3_REGION}"
else
  is_local_host "$db_host" && refuse "DB_URL must not point at a loopback host when BACKUP_ENV=$BACKUP_ENV"
  [[ "$BACKUP_S3_ENDPOINT" =~ ^https:// ]] || refuse "BACKUP_S3_ENDPOINT must be https when BACKUP_ENV=$BACKUP_ENV"
  is_local_host "$target_host" && refuse "BACKUP_S3_ENDPOINT must not point at a loopback host when BACKUP_ENV=$BACKUP_ENV"
  [[ "$STORAGE_S3_ENDPOINT" =~ ^https:// ]] || refuse "STORAGE_S3_ENDPOINT must be https when BACKUP_ENV=$BACKUP_ENV"
  is_local_host "$storage_host" && refuse "STORAGE_S3_ENDPOINT must not point at a loopback host when BACKUP_ENV=$BACKUP_ENV"
  [[ "$target_host" != "$storage_host" ]] || refuse "BACKUP_S3_ENDPOINT must not be the source project's Storage endpoint"
  BACKUP_S3_REGION="${BACKUP_S3_REGION:-auto}"
fi

recipients=()
for r in $(printf '%s' "${BACKUP_AGE_RECIPIENTS:-}" | tr ',' ' '); do
  [[ "$r" =~ ^age1[02-9ac-hj-np-z]{58}$ ]] || refuse "BACKUP_AGE_RECIPIENTS holds a value that is not an age1... public key"
  dup=0
  for seen in ${recipients[@]+"${recipients[@]}"}; do [[ "$seen" == "$r" ]] && dup=1; done
  [[ $dup -eq 0 ]] && recipients+=("$r")
done
[[ ${#recipients[@]} -ge 2 ]] || refuse "BACKUP_AGE_RECIPIENTS needs at least 2 distinct age1... recipients (primary + break-glass)"

if [[ "$MODE" == "check" ]]; then
  echo "backup: configuration ok (env=$BACKUP_ENV, recipients=${#recipients[@]}, prefix=$BACKUP_S3_PREFIX)"
  exit 0
fi

if [[ "${FORCE_FAIL:-}" == "1" ]]; then
  log "backup.failed error_code=forced_failure env=$BACKUP_ENV (FORCE_FAIL drill: no connection made)"
  exit 64
fi

# ---------------------------------------------------------------------------------------------------------------------
# 2. Tools.
# ---------------------------------------------------------------------------------------------------------------------
AGE="${AGE_BIN:-}"
if [[ -z "$AGE" ]]; then
  if command -v age > /dev/null 2>&1; then AGE="$(command -v age)"; else AGE="$("$BIN/install-age.sh" | tail -n 1)/age"; fi
fi
[[ -x "$AGE" ]] || { echo "backup: age is not executable" >&2; exit 1; }

WORK="$(mktemp -d)"
STAGE="$WORK/stage"
mkdir -p "$STAGE/storage"
STEP=setup
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
STARTED_EPOCH="$(date -u +%s)"
DB_REACHED=0
ROW_WRITTEN=0
HAS_DIGEST_COLUMN=0

psql_db() { PSQL_DB_URL="$DB_URL" PSQL_MOUNT="$WORK" "$BIN/psql-docker.sh" -X -v ON_ERROR_STOP=1 -q "$@"; }

s3_env() { # common settings for S3-compatible endpoints (R2, Supabase Storage): checksums only when required
  AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required AWS_DOCKER_MOUNT="$WORK" "$@"
}

aws_target() {
  AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY" \
    AWS_REGION="$BACKUP_S3_REGION" s3_env "$BIN/aws-docker.sh" "$@" --endpoint-url "$BACKUP_S3_ENDPOINT"
}

aws_storage() {
  AWS_ACCESS_KEY_ID="$STORAGE_S3_KEY_ID" AWS_SECRET_ACCESS_KEY="$STORAGE_S3_SECRET" AWS_REGION="$STORAGE_S3_REGION" \
    s3_env "$BIN/aws-docker.sh" "$@" --endpoint-url "$STORAGE_S3_ENDPOINT"
}

supabase_cli() {
  if [[ -x "$REPO/node_modules/.bin/supabase" ]]; then
    "$REPO/node_modules/.bin/supabase" "$@"
  else
    npx --yes "supabase@${SUPABASE_CLI_VERSION}" "$@"
  fi
}

dump() {
  if [[ "$BACKUP_ENV" == "local" ]]; then
    supabase_cli db dump --local --workdir "$SUPABASE_WORKDIR" "$@" 2>&1 | redact
  else
    # The URL carries no password in the workflow (target-guard --no-password); pgx reads PGPASSWORD (04-00, L-7).
    supabase_cli db dump --db-url "$DB_URL" "$@" 2>&1 | redact
  fi
}

sql_literal() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/''/g")"; }

record_run() { # status object_key archive_bytes counts_file error_code [archive_sha256]
  local status="$1" key="$2" bytes="$3" counts="$4" code="$5" sha="${6:-}" finished duration
  finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  duration=$(($(date -u +%s) - STARTED_EPOCH))
  local counts_sql="null"
  [[ -n "$counts" && -s "$counts" ]] && counts_sql="$(sql_literal "$(cat "$counts")")::jsonb"
  local key_sql="null" bytes_sql="null" code_sql="null"
  [[ -n "$key" ]] && key_sql="$(sql_literal "$key")"
  [[ -n "$bytes" ]] && bytes_sql="$bytes"
  [[ -n "$code" ]] && code_sql="$(sql_literal "$code")"
  # 04-07c (M-BACKUPAUTH): the archive digest, once migration 000042 added the column (a run of this script before the
  # migration reached the database still records its row; the job summary and artifact carry the digest either way).
  local sha_col="" sha_sql=""
  if [[ "$HAS_DIGEST_COLUMN" == "1" ]]; then
    sha_col=", archive_sha256"
    sha_sql=", null"
    [[ -n "$sha" ]] && sha_sql=", $(sql_literal "$sha")"
  fi
  printf 'insert into ops.backup_runs (environment, started_at, finished_at, status, object_key, archive_bytes, duration_s, manifest_counts, error_code%s) values (%s, %s, %s, %s, %s, %s, %s, %s, %s%s);\n' \
    "$sha_col" "$(sql_literal "$BACKUP_ENV")" "$(sql_literal "$STARTED_AT")" "$(sql_literal "$finished")" "$(sql_literal "$status")" \
    "$key_sql" "$bytes_sql" "$duration" "$counts_sql" "$code_sql" "$sha_sql" > "$WORK/record.sql"
  psql_db -f "$WORK/record.sql" 2>&1 | redact
}

on_exit() {
  local code=$?
  trap - EXIT
  if [[ $code -ne 0 && $DB_REACHED -eq 1 && $ROW_WRITTEN -eq 0 ]]; then
    log "backup.failed error_code=${STEP}_failed env=$BACKUP_ENV"
    record_run failed "" "" "" "${STEP}_failed" > /dev/null 2>&1 || log "backup.failed_row_not_written"
  elif [[ $code -ne 0 && $code -ne 3 ]]; then
    log "backup.failed error_code=${STEP}_failed env=$BACKUP_ENV"
  fi
  rm -rf "$WORK"
  exit "$code"
}
trap on_exit EXIT

if [[ "$BACKUP_ENV" == "local" ]]; then
  SUPABASE_WORKDIR="${SUPABASE_WORKDIR:-$(cd "$HERE/../.." && pwd)}"
  [[ -f "$SUPABASE_WORKDIR/supabase/config.toml" ]] || { echo "backup: SUPABASE_WORKDIR has no supabase/config.toml" >&2; exit 2; }
fi

log "backup.start env=$BACKUP_ENV recipients=${#recipients[@]} cli=$SUPABASE_CLI_VERSION"

# ---------------------------------------------------------------------------------------------------------------------
# 3. Database: roles, schema, data (cron/net queues and vector tables excluded, pitfall 8), migration history, and the
#    storage.objects policies (the CLI's schema dump excludes the storage schema, so they are generated here).
# ---------------------------------------------------------------------------------------------------------------------
STEP=connect
psql_db -At -c "select 1" > /dev/null
DB_REACHED=1
HAS_DIGEST_COLUMN="$(psql_db -At -c "select count(*) from pg_catalog.pg_attribute where attrelid = pg_catalog.to_regclass('ops.backup_runs') and attname = 'archive_sha256' and not attisdropped")"

STEP=dump
dump -f "$STAGE/roles.sql" --role-only
dump -f "$STAGE/schema.sql"
dump -f "$STAGE/data.sql" --data-only --use-copy \
  -x cron.job -x cron.job_run_details -x net.http_request_queue -x net._http_response \
  -x storage.buckets_vectors -x storage.vector_indexes
dump -f "$STAGE/history_schema.sql" --schema supabase_migrations
dump -f "$STAGE/history_data.sql" --data-only --use-copy --schema supabase_migrations

psql_db -At -o "$STAGE/storage_policies.sql" <<'SQL'
set search_path = '';
select format(
  'create policy %I on %I.%I as %s for %s to %s%s%s;',
  policyname, schemaname, tablename, permissive, cmd,
  (select string_agg(case when r = 'public' then 'public' else quote_ident(r) end, ', ') from unnest(roles) r),
  coalesce(' using (' || qual || ')', ''),
  coalesce(' with check (' || with_check || ')', ''))
from pg_policies
where schemaname = 'storage'
order by tablename, policyname;
SQL

psql_db -At -F $'\t' -o "$WORK/db_facts.tsv" <<'SQL'
select 'server_version', current_setting('server_version')
union all select 'database_bytes', pg_database_size(current_database())::text
union all select 'policies', count(*)::text from pg_policies where schemaname in ('public', 'storage')
union all select 'functions', count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private', 'ops')
    and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
union all select 'rls_tables', count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity;
SQL

# Row counts come from the dump itself (one COPY line per row), so they describe exactly what a restore loads.
awk '
  /^COPY / { t = $2; gsub(/"/, "", t); n = 0; inblk = 1; next }
  inblk && /^\\\.$/ { print t "\t" n; inblk = 0; next }
  inblk { n++ }
' "$STAGE/data.sql" > "$WORK/row_counts.tsv"
log "backup.dumped tables=$(wc -l < "$WORK/row_counts.tsv" | tr -d ' ') data_bytes=$(wc -c < "$STAGE/data.sql" | tr -d ' ')"

# ---------------------------------------------------------------------------------------------------------------------
# 4. Storage: every bucket synced through the Supabase S3 protocol (the local stand-in's own target bucket excluded).
# ---------------------------------------------------------------------------------------------------------------------
STEP=storage
psql_db -At -c "select id from storage.buckets order by id" > "$WORK/buckets.txt"
: > "$WORK/excluded_buckets.txt"
while IFS= read -r bucket; do
  [[ -z "$bucket" ]] && continue
  [[ "$bucket" =~ ^[A-Za-z0-9._-]+$ && "$bucket" != "." && "$bucket" != ".." ]] || { echo "backup: unexpected bucket id" >&2; exit 1; }
  if [[ "$BACKUP_ENV" == "local" && "$bucket" == "$BACKUP_S3_BUCKET" ]]; then
    echo "$bucket" >> "$WORK/excluded_buckets.txt"
    continue
  fi
  mkdir -p "$STAGE/storage/$bucket"
  # stdin from /dev/null: the containerised CLI must not swallow the rest of the bucket list this loop reads.
  aws_storage s3 sync "s3://$bucket" "$STAGE/storage/$bucket" --only-show-errors < /dev/null 2>&1 | redact
done < "$WORK/buckets.txt"

# ---------------------------------------------------------------------------------------------------------------------
# 5. Manifest (inside the encrypted archive: per-object SHA-256 and names) and the counts-only row for ops.backup_runs.
# ---------------------------------------------------------------------------------------------------------------------
STEP=manifest
FINISHED_DUMP_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
node - "$STAGE" "$WORK" "$BACKUP_ENV" "$STARTED_AT" "$FINISHED_DUMP_AT" "$SUPABASE_CLI_VERSION" <<'JS'
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const [stage, work, environment, dumpStartedAt, dumpFinishedAt, cliVersion] = process.argv.slice(2);
const tsv = (f) => fs.readFileSync(path.join(work, f), "utf8").split("\n").filter(Boolean).map((l) => l.split("\t"));
const facts = Object.fromEntries(tsv("db_facts.tsv"));
const tables = Object.fromEntries(tsv("row_counts.tsv").map(([t, n]) => [t, Number(n)]));
const excluded = fs.readFileSync(path.join(work, "excluded_buckets.txt"), "utf8").split("\n").filter(Boolean);
const bucketIds = fs.readFileSync(path.join(work, "buckets.txt"), "utf8").split("\n").filter(Boolean);
const buckets = {};
const counts = {};
for (const id of bucketIds) {
  if (excluded.includes(id)) continue;
  const root = path.join(stage, "storage", id);
  const objects = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) {
        const body = fs.readFileSync(full);
        objects.push({ name: path.relative(root, full).split(path.sep).join("/"), size: body.length, sha256: crypto.createHash("sha256").update(body).digest("hex") });
      }
    }
  };
  if (fs.existsSync(root)) walk(root);
  objects.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  buckets[id] = { objects };
  counts[id] = { objects: objects.length, bytes: objects.reduce((s, o) => s + o.size, 0) };
}
const manifest = {
  format_version: 1,
  environment,
  dump_started_at: dumpStartedAt,
  dump_finished_at: dumpFinishedAt,
  cli_version: cliVersion,
  server_version: facts.server_version,
  database_bytes: Number(facts.database_bytes),
  policies: Number(facts.policies),
  functions: Number(facts.functions),
  rls_tables: Number(facts.rls_tables),
  auth_users: tables["auth.users"] ?? 0,
  tables,
  buckets,
  excluded_buckets: excluded,
};
fs.writeFileSync(path.join(stage, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
// Counts only for the database row: table row counts and per-bucket object count/bytes, never object names.
const rows = Object.values(tables).reduce((s, n) => s + n, 0);
fs.writeFileSync(path.join(work, "counts.json"), JSON.stringify({ tables, buckets: counts, total_rows: rows }));
const objects = Object.values(counts).reduce((s, c) => s + c.objects, 0);
const bytes = Object.values(counts).reduce((s, c) => s + c.bytes, 0);
process.stdout.write(`buckets=${Object.keys(counts).length} objects=${objects} object_bytes=${bytes} rows=${rows}\n`);
JS
log "backup.manifest written"

# ---------------------------------------------------------------------------------------------------------------------
# 6. Encrypt (age, every recipient) and check the header before anything leaves this machine.
# ---------------------------------------------------------------------------------------------------------------------
STEP=encrypt
NAME="$(date -u +%Y-%m-%dT%H%M%SZ).tar.age"
ARCHIVE="$WORK/$NAME"
age_args=()
for r in "${recipients[@]}"; do age_args+=(-r "$r"); done
tar -C "$STAGE" -cf - . | "$AGE" "${age_args[@]}" -o "$ARCHIVE"
rm -rf "$STAGE"
header="$(head -c 21 "$ARCHIVE")"
[[ "$header" == "age-encryption.org/v1" ]] || { echo "backup: archive does not start with the age header" >&2; exit 1; }
ARCHIVE_BYTES="$(wc -c < "$ARCHIVE" | tr -d ' ')"
if command -v sha256sum > /dev/null 2>&1; then ARCHIVE_SHA="$(sha256sum "$ARCHIVE" | cut -d' ' -f1)"; else ARCHIVE_SHA="$(shasum -a 256 "$ARCHIVE" | cut -d' ' -f1)"; fi
log "backup.encrypted age_header=ok bytes=$ARCHIVE_BYTES sha256=$ARCHIVE_SHA"

# ---------------------------------------------------------------------------------------------------------------------
# 7. Upload (no SSE flags: R2 encrypts at rest itself; the archive is already age-encrypted; the stand-in accepts it).
# ---------------------------------------------------------------------------------------------------------------------
STEP=upload
KEY="${BACKUP_S3_PREFIX}${NAME}"
aws_target s3 cp "$ARCHIVE" "s3://$BACKUP_S3_BUCKET/$KEY" --only-show-errors < /dev/null 2>&1 | redact
log "backup.uploaded key=$KEY"

# 04-07c (M-BACKUPAUTH): the digest outside the bucket, where the restore reads it (--expect-sha256).
if [[ -n "${BACKUP_DIGEST_OUT:-}" ]]; then
  printf '{"format_version":1,"environment":"%s","object_key":"%s","archive_sha256":"%s","archive_bytes":%s}\n' \
    "$BACKUP_ENV" "$KEY" "$ARCHIVE_SHA" "$ARCHIVE_BYTES" > "$BACKUP_DIGEST_OUT"
fi
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  printf '### Backup archive\n\n| object key | SHA-256 | bytes |\n|---|---|---|\n| `%s` | `%s` | %s |\n\nRestore with `--expect-sha256 %s` (docs/runbooks/backup-restore.md §7).\n' \
    "$KEY" "$ARCHIVE_SHA" "$ARCHIVE_BYTES" "$ARCHIVE_SHA" >> "$GITHUB_STEP_SUMMARY"
fi

STEP=record
record_run ok "$KEY" "$ARCHIVE_BYTES" "$WORK/counts.json" "" "$ARCHIVE_SHA"
ROW_WRITTEN=1

# ---------------------------------------------------------------------------------------------------------------------
# 8. Dead-man for the scheduler (R-41): a configured runner with no ok pass in 15 minutes fails this run, so the
#    backup-alert workflow opens/updates the "Staging backup failing" issue, independently of the app.
# ---------------------------------------------------------------------------------------------------------------------
STEP=deadman
stale="$(psql_db -At -c "select ops.backup_runner_stale()")"
DURATION=$(($(date -u +%s) - STARTED_EPOCH))
log "backup.done env=$BACKUP_ENV key=$KEY bytes=$ARCHIVE_BYTES duration_s=$DURATION"
if [[ "$stale" == "t" ]]; then
  log "backup.deadman runner_stale"
  exit 3
fi
