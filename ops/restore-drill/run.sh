#!/usr/bin/env bash
# FT-02 restore drill (V2-04 04-05a; rulings R-4, R-11, R-29): decrypts a backup archive, restores it into the drill
# stack (a second local Supabase stack, project `clinicos-drill`, ports 553xx), verifies it and writes evidence with
# counts, verdicts, RPO and RTO only. The drill stack is stopped with --no-backup and the plaintext deleted on every exit.
#
# Usage:
#   ops/restore-drill/run.sh --dump <file.tar.age> --identity <age key file> --expect-sha256 <hex> [--evidence <out.json>]
#   ops/restore-drill/run.sh --dump <file.tar.age> --identity <age key file> --expect-sha256 <hex> --decrypt-only
#   ops/restore-drill/run.sh --self-test [--evidence <out.json>]
#
# --dump/--identity paths must be OUTSIDE this repository (real dumps and keys never enter the repo or an agent
# session, R-29). --decrypt-only proves a key (e.g. the break-glass key) without restoring or writing plaintext.
# --expect-sha256 (04-07c, M-BACKUPAUTH): the archive's SHA-256 as the green GitHub backup.yml run recorded it (its
# job summary or its `backup-evidence` artifact `archive-digest.json`), never from the bucket and never from
# `ops.backup_runs` (04-07d, N-2: the backup Environment's database URL can write that table). The archive is refused
# before `age -d` when it differs: age gives confidentiality only, and the R2 token can replace an object. After
# decrypting, ops/restore-drill/sql-guard.ts refuses SQL that holds a psql meta-command (`\! …`) before any of it runs
# and writes the restore copies; the restore runs them with psql in restricted mode under a fresh key (04-07d, N-2:
# ops/bin/psql-restricted.sh, so psql itself refuses every meta-command), and every psql call runs with -X.
# --self-test (local only, synthetic data): seeds the primary local stack (`npm run seed:local`), uploads one synthetic
# Storage object, generates two throwaway age key pairs in a temp dir, runs ops/backup/backup.sh with BACKUP_ENV=local
# (the local Storage S3 endpoint stands in for the R2 bucket), downloads the archive from the stand-in, runs the drill with
# the first key, decrypts once with the second (break-glass path) and refuses a third, unrelated key. Every key and the
# archive are deleted afterwards.
#
# Exit 0 = drill passed (evidence written); 1 = a check failed; 2 = usage or a refused path.
set -euo pipefail
umask 077

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
BIN="$ROOT/ops/bin"
DRILL_WORKDIR="$ROOT/ops/restore-drill"
DRILL_EXCLUDE="studio,edge-runtime,logflare,vector,imgproxy,supavisor,kong,postgrest,mailpit,postgres-meta"
# shellcheck source=../bin/pins.env
source "$BIN/pins.env"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { echo "restore-drill: $*" >&2; exit "${2:-1}"; }
usage() { sed -n '6,9p' "$0" | sed 's/^# //' >&2; exit 2; }

DUMP="" IDENTITY="" EVIDENCE="" MODE="" EXPECT_SHA=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dump) DUMP="${2:-}"; shift 2 ;;
    --identity) IDENTITY="${2:-}"; shift 2 ;;
    --evidence) EVIDENCE="${2:-}"; shift 2 ;;
    --expect-sha256) EXPECT_SHA="$(printf '%s' "${2:-}" | tr '[:upper:]' '[:lower:]')"; shift 2 ;;
    --decrypt-only) MODE=decrypt-only; shift ;;
    --self-test) MODE=self-test; shift ;;
    *) usage ;;
  esac
done
[[ -z "$MODE" ]] && MODE=archive
if [[ "$MODE" == "self-test" ]]; then
  [[ -z "$DUMP" && -z "$IDENTITY" && -z "$EXPECT_SHA" ]] || usage
else
  [[ -n "$DUMP" && -n "$IDENTITY" && -n "$EXPECT_SHA" ]] || usage
  [[ "$EXPECT_SHA" =~ ^[0-9a-f]{64}$ ]] \
    || die "--expect-sha256 must be the 64 hex characters the backup run recorded (job summary or archive-digest.json)" 2
fi

abs_path() { # absolute, symlinks resolved for the directory part
  local d b
  d="$(dirname "$1")"
  b="$(basename "$1")"
  [[ -d "$d" ]] || return 1
  printf '%s/%s' "$(cd "$d" && pwd -P)" "$b"
}
inside_repo() {
  local p root
  p="$(abs_path "$1")" || return 1
  root="$(cd "$ROOT" && pwd -P)"
  [[ "$p" == "$root" || "$p" == "$root/"* ]]
}

if [[ "$MODE" != "self-test" ]]; then
  for f in "$DUMP" "$IDENTITY"; do
    [[ -f "$f" ]] || die "file not found (pass --dump and --identity paths that exist)" 2
    inside_repo "$f" && die "refusing a dump or identity path inside the repository; keep them outside it (R-29)" 2
  done
  DUMP="$(abs_path "$DUMP")"
  IDENTITY="$(abs_path "$IDENTITY")"
fi
if [[ -n "$EVIDENCE" ]]; then
  EVIDENCE="$(abs_path "$EVIDENCE")" || die "the evidence directory does not exist" 2
fi

AGE="${AGE_BIN:-}"
if [[ -z "$AGE" ]]; then
  if command -v age > /dev/null 2>&1; then AGE="$(command -v age)"; else AGE="$("$BIN/install-age.sh" | tail -n 1)/age"; fi
fi
AGE_KEYGEN="$(dirname "$AGE")/age-keygen"
AGE_VERSION_STR="$("$AGE" --version)"

WORK="$(mktemp -d)"
DRILL_STARTED=0
SELFTEST_BUCKETS=0
CHECK_DECRYPT=false CHECK_WRONG_KEY=false CHECK_RESTORE=false CHECK_HISTORY=false CHECK_SQL=false
CHECK_DIGEST=false CHECK_SQL_GUARD=false
PGTAP_TESTS=0 MIGRATIONS=0 ARCHIVE_BYTES=0
cleanup() {
  local code=$?
  trap - EXIT
  if [[ $DRILL_STARTED -eq 1 ]]; then
    npx supabase stop --workdir "$DRILL_WORKDIR" --no-backup > /dev/null 2>&1 || true
  fi
  if [[ $SELFTEST_BUCKETS -eq 1 ]]; then selftest_remove_buckets; fi
  rm -rf "$WORK"
  exit "$code"
}
trap cleanup EXIT

json_get() { node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const v=process.argv[2].split(".").reduce((o,k)=>o?.[k],m);process.stdout.write(v===undefined?"":String(v))' "$1" "$2"; }
iso_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# Local stack facts from `supabase status` (values captured, never printed).
status_value() { # <workdir> <NAME>
  npx supabase status --workdir "$1" -o env 2> /dev/null | sed -n "s/^$2=\"\(.*\)\"\$/\1/p"
}

sha256_of() {
  if command -v sha256sum > /dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

# 04-07c (M-BACKUPAUTH): the archive must be the one the backup run recorded, before age ever reads it.
verify_digest() { # <archive> <expected sha256>
  local got
  got="$(sha256_of "$1")"
  if [[ "$got" != "$2" ]]; then
    die "archive SHA-256 does not match the recorded digest: refused before decrypt (tampered, planted or wrong archive)"
  fi
  CHECK_DIGEST=true
  log "restore-drill.digest ok"
}

# ---------------------------------------------------------------------------------------------------------------------
# Decrypt-only: prove a key opens the archive (tar listing only; nothing is written to disk).
# ---------------------------------------------------------------------------------------------------------------------
decrypt_only() { # <archive> <identity>
  local n
  n="$("$AGE" -d -i "$2" "$1" | tar -tf - | wc -l | tr -d ' ')"
  [[ "$n" -gt 0 ]] || return 1
  log "restore-drill.decrypt_only ok entries=$n"
}

# ---------------------------------------------------------------------------------------------------------------------
# The drill: decrypt -> drill stack -> restore -> verify -> evidence values in $WORK/facts.
# ---------------------------------------------------------------------------------------------------------------------
run_drill() { # <archive> <identity>
  local archive="$1" identity="$2" plain="$WORK/plain"
  DRILL_STARTED_AT="$(iso_now)"
  DRILL_STARTED_EPOCH="$(date -u +%s)"
  mkdir -p "$plain"

  log "restore-drill.decrypt"
  "$AGE" -d -i "$identity" "$archive" | tar -xf - -C "$plain"
  [[ -f "$plain/manifest.json" ]] || die "archive has no manifest.json"
  [[ "$(json_get "$plain/manifest.json" format_version)" == "1" ]] || die "unsupported manifest format_version"
  CHECK_DECRYPT=true

  # 04-07c (M-BACKUPAUTH): no psql meta-command in any SQL file, checked before anything is executed. 04-07d (N-2): the
  # guard writes the restore copies the restore runs (pg_dump's own \restrict lines as comments) to $plain/restore.
  log "restore-drill.sql_guard"
  (cd "$ROOT" && npx tsx ops/restore-drill/sql-guard.ts --emit-dir "$plain/restore" "$plain/roles.sql" "$plain/schema.sql" \
    "$plain/storage_policies.sql" "$plain/data.sql" "$plain/history_schema.sql" "$plain/history_data.sql") \
    || die "the archive's SQL holds a psql meta-command or a refused COPY form: refused before restore"
  CHECK_SQL_GUARD=true

  # A key that is not a recipient must not open the archive.
  "$AGE_KEYGEN" -o "$WORK/unrelated.key" 2> /dev/null
  if "$AGE" -d -i "$WORK/unrelated.key" "$archive" > /dev/null 2>&1; then die "an unrelated age key opened the archive"; fi
  rm -f "$WORK/unrelated.key"
  CHECK_WRONG_KEY=true

  log "restore-drill.stack_start project=clinicos-drill"
  npx supabase stop --workdir "$DRILL_WORKDIR" --no-backup > /dev/null 2>&1 || true
  DRILL_STARTED=1
  npx supabase start --workdir "$DRILL_WORKDIR" -x "$DRILL_EXCLUDE" > "$WORK/drill-start.log" 2>&1 \
    || { tail -n 5 "$WORK/drill-start.log" | sed -E 's#[A-Za-z]+://[^[:space:]]+#<url>#g' >&2; die "drill stack did not start"; }
  DRILL_DB_URL="$(status_value "$DRILL_WORKDIR" DB_URL)"
  [[ "$DRILL_DB_URL" == *"@127.0.0.1:55322/"* ]] || die "drill stack DB is not on 127.0.0.1:55322"

  drill_psql() { PSQL_DB_URL="$DRILL_DB_URL" PSQL_MOUNT="$WORK" "$BIN/psql-docker.sh" -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=terse "$@"; }
  # The archive's SQL runs only through this one (04-07d, N-2): psql restricted under a fresh key for the whole session.
  restore_psql() { PSQL_DB_URL="$DRILL_DB_URL" PSQL_MOUNT="$WORK" "$BIN/psql-restricted.sh" -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=terse "$@"; }

  log "restore-drill.restore"
  # Parameter privileges granted to Supabase-managed roles are platform state the target already manages (and only a
  # superuser may grant them), like the managed-role lines the CLI itself comments out of a role dump: skip them.
  sed -E 's/^GRANT (SET|ALTER SYSTEM)( ?, ?(SET|ALTER SYSTEM))? ON PARAMETER .* TO "(anon|authenticated|authenticator|dashboard_user|pgbouncer|postgres|service_role|supabase_[a-z_]*|pgsodium_[a-z]*|pgtle_admin)"( WITH GRANT OPTION)?;$/-- (managed by the platform) &/' \
    "$plain/restore/roles.sql" > "$plain/restore/roles.restore.sql"
  (cd "$plain/restore" && restore_psql --single-transaction \
    -f roles.restore.sql -f schema.sql -f storage_policies.sql \
    -c 'SET session_replication_role = replica' -f data.sql > "$WORK/restore.log" 2>&1) \
    || { grep -E "ERROR" "$WORK/restore.log" | head -n 3 >&2; die "restore failed (Supabase-documented order: roles, schema, data)"; }
  CHECK_RESTORE=true
  (cd "$plain/restore" && restore_psql --single-transaction -f history_schema.sql -f history_data.sql > "$WORK/history.log" 2>&1) \
    || { grep -E "ERROR" "$WORK/history.log" | head -n 3 >&2; die "migration history restore failed"; }
  MIGRATIONS="$(drill_psql -At -c "select count(*) from supabase_migrations.schema_migrations")"
  CHECK_HISTORY=true

  log "restore-drill.verify"
  node - "$plain/manifest.json" "$WORK/counts.sql" <<'JS'
const fs = require("node:fs");
const [manifestPath, out] = process.argv.slice(2);
const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const q = (id) => '"' + id.replace(/"/g, '""') + '"';
const lit = (s) => "'" + s.replace(/'/g, "''") + "'";
const parts = Object.keys(m.tables).sort().map((t) => {
  const [schema, ...rest] = t.split(".");
  return `select ${lit(t)}, count(*) from ${q(schema)}.${q(rest.join("."))}`;
});
fs.writeFileSync(out, (parts.length ? parts.join("\nunion all ") : "select null, null where false") + ";\n");
JS
  drill_psql -At -F $'\t' -f "$WORK/counts.sql" -o "$WORK/restored_counts.tsv"
  drill_psql -At -F $'\t' -o "$WORK/restored_objects.tsv" \
    -c "select bucket_id, name, coalesce(metadata->>'size', '') from storage.objects order by 1, 2"
  (cd "$ROOT" && npx tsx ops/restore-drill/compare-manifest.ts --manifest "$plain/manifest.json" \
    --restored-counts "$WORK/restored_counts.tsv" --restored-objects "$WORK/restored_objects.tsv" \
    --storage-dir "$plain/storage" --out "$WORK/compare.json")
  CHECK_OBJECTS="$(json_get "$WORK/compare.json" ok)"
  CHECK_MANIFEST="$CHECK_OBJECTS"

  cp "$ROOT/supabase/tests/restore_drill_checks.sql" "$WORK/restore_drill_checks.sql"
  drill_psql -At \
    -v expected_policies="$(json_get "$plain/manifest.json" policies)" \
    -v expected_functions="$(json_get "$plain/manifest.json" functions)" \
    -v expected_users="$(json_get "$plain/manifest.json" auth_users)" \
    -f "$WORK/restore_drill_checks.sql" > "$WORK/tap.out" 2>&1 \
    || { grep -E "^(not ok|#)|ERROR" "$WORK/tap.out" | head -n 20 >&2; die "restore_drill_checks.sql failed"; }
  PGTAP_TESTS="$(grep -c '^ok ' "$WORK/tap.out" || true)"
  grep -q '^not ok' "$WORK/tap.out" && die "restore_drill_checks.sql reported a failure"
  CHECK_SQL=true
  CHECKS_GREEN_AT="$(iso_now)"
  CHECKS_GREEN_EPOCH="$(date -u +%s)"
  log "restore-drill.checks_green pgtap=$PGTAP_TESTS"

  MANIFEST_COPY="$WORK/manifest.json"
  cp "$plain/manifest.json" "$MANIFEST_COPY"
  ARCHIVE_BYTES="$(wc -c < "$archive" | tr -d ' ')"
  rm -rf "$plain"
  npx supabase stop --workdir "$DRILL_WORKDIR" --no-backup > /dev/null 2>&1
  DRILL_STARTED=0
  log "restore-drill.stack_stopped (data volumes removed)"
}

write_evidence() { # <out> <mode> [breakglass] [failed_recorded] [tampered_refused]
  local out="$1" mode="$2" breakglass="${3:-}" failed_recorded="${4:-}" tampered_refused="${5:-}"
  node - "$out" "$mode" "$breakglass" "$MANIFEST_COPY" "$WORK/compare.json" "$failed_recorded" "$tampered_refused" <<JS
const fs = require("node:fs");
const [out, mode, breakglass, manifestPath, comparePath, failedRecorded, tamperedRefused] = process.argv.slice(2);
const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const c = JSON.parse(fs.readFileSync(comparePath, "utf8"));
const drillStarted = "$DRILL_STARTED_AT";
const green = "$CHECKS_GREEN_AT";
const rto = $CHECKS_GREEN_EPOCH - $DRILL_STARTED_EPOCH;
const rpo = Math.round((Date.parse(drillStarted) - Date.parse(m.dump_started_at)) / 1000);
const checks = {
  archive_digest: $CHECK_DIGEST,
  sql_guard: $CHECK_SQL_GUARD,
  decrypt: $CHECK_DECRYPT,
  wrong_key_refused: $CHECK_WRONG_KEY,
  restore: $CHECK_RESTORE,
  migration_history: $CHECK_HISTORY,
  objects_verified: c.ok === true,
  manifest_compare: c.ok === true,
  drill_checks_sql: $CHECK_SQL,
};
if (mode === "self-test") {
  checks.breakglass_decrypt = breakglass === "true";
  checks.failed_run_recorded = failedRecorded === "true";
  checks.tampered_archive_refused = tamperedRefused === "true";
}
const evidence = {
  format_version: 1,
  kind: "restore-drill",
  mode,
  environment: m.environment,
  result: Object.values(checks).every((v) => v === true) ? "pass" : "fail",
  dump_started_at: m.dump_started_at,
  drill_started_at: drillStarted,
  checks_green_at: green,
  rpo_seconds: rpo,
  rto_seconds: rto,
  dump_age_h: Math.round((rpo / 3600) * 10) / 10,
  targets: { rpo_seconds_max: 43200, rto_seconds_max: 14400 },
  checks,
  counts: {
    tables: c.tables,
    rows: c.rows,
    buckets: c.buckets,
    objects: c.objects_verified,
    object_bytes: c.object_bytes,
    objects_excluded: c.objects_excluded,
    files_without_row: c.files_without_row,
    policies: m.policies,
    functions: m.functions,
    rls_tables: m.rls_tables,
    auth_users: m.auth_users,
    pgtap_tests: Number("$PGTAP_TESTS"),
    migrations: Number("$MIGRATIONS"),
    archive_bytes: Number("$ARCHIVE_BYTES"),
  },
  versions: { server: String(m.server_version).split(" ")[0], cli: m.cli_version, age: "$AGE_VERSION_STR" },
};
fs.writeFileSync(out, JSON.stringify(evidence, null, 2) + "\n");
JS
  (cd "$ROOT" && npx tsx ops/restore-drill/check-evidence.ts "$out")
}

# ---------------------------------------------------------------------------------------------------------------------
# Self-test: everything synthetic and local; the archive and every key live in a temp dir outside the repo.
# ---------------------------------------------------------------------------------------------------------------------
SRC_BUCKET="drill-selftest-src"
TARGET_BUCKET_ST="drill-selftest-target"
ST_KEY_ID="" ST_SECRET="" ST_REGION="" ST_S3_URL=""
s3() {
  AWS_ACCESS_KEY_ID="$ST_KEY_ID" AWS_SECRET_ACCESS_KEY="$ST_SECRET" AWS_REGION="$ST_REGION" \
    AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required \
    AWS_DOCKER_MOUNT="$WORK" "$BIN/aws-docker.sh" "$@" --endpoint-url "$ST_S3_URL"
}
selftest_remove_buckets() {
  s3 s3 rb "s3://$SRC_BUCKET" --force > /dev/null 2>&1 || true
  s3 s3 rb "s3://$TARGET_BUCKET_ST" --force > /dev/null 2>&1 || true
}

self_test() {
  local db_url s3_url key_id secret region
  db_url="$(status_value "$ROOT" DB_URL)"
  s3_url="$(status_value "$ROOT" STORAGE_S3_URL)"
  key_id="$(status_value "$ROOT" S3_PROTOCOL_ACCESS_KEY_ID)"
  secret="$(status_value "$ROOT" S3_PROTOCOL_ACCESS_KEY_SECRET)"
  region="$(status_value "$ROOT" S3_PROTOCOL_REGION)"
  [[ -n "$db_url" && -n "$s3_url" && -n "$key_id" && -n "$secret" ]] || die "the primary local stack is not running (npx supabase start)"
  [[ "$db_url" == *"@127.0.0.1:"* && "$s3_url" == "http://127.0.0.1:"* ]] || die "the primary stack is not on loopback"

  local keys="$WORK/keys"
  mkdir -p "$keys"
  ST_KEY_ID="$key_id" ST_SECRET="$secret" ST_REGION="$region" ST_S3_URL="$s3_url"
  # Leftovers of an interrupted run; the EXIT trap removes this run's buckets on every exit.
  selftest_remove_buckets
  SELFTEST_BUCKETS=1

  log "restore-drill.selftest seed (npm run seed:local, synthetic)"
  (cd "$ROOT" && LOCAL_DEV_SEED_PASSWORD="Drill-$(od -An -N12 -tx1 /dev/urandom | tr -d ' \n')" npm run --silent seed:local > /dev/null 2>&1) \
    || die "npm run seed:local failed"

  log "restore-drill.selftest storage (one synthetic object)"
  s3 s3 mb "s3://$SRC_BUCKET" > /dev/null
  s3 s3 mb "s3://$TARGET_BUCKET_ST" > /dev/null
  head -c 4096 /dev/urandom > "$WORK/synthetic-object.bin"
  s3 s3 cp "$WORK/synthetic-object.bin" "s3://$SRC_BUCKET/selftest/synthetic-object.bin" --only-show-errors

  log "restore-drill.selftest keys (two throwaway age key pairs)"
  "$AGE_KEYGEN" -o "$keys/primary.key" 2> /dev/null
  "$AGE_KEYGEN" -o "$keys/breakglass.key" 2> /dev/null
  local r1 r2
  r1="$("$AGE_KEYGEN" -y "$keys/primary.key")"
  r2="$("$AGE_KEYGEN" -y "$keys/breakglass.key")"

  log "restore-drill.selftest backup (ops/backup/backup.sh, BACKUP_ENV=local)"
  local backup_rc=0 before_id
  before_id="$(PSQL_DB_URL="$db_url" PSQL_MOUNT="$WORK" "$BIN/psql-docker.sh" -X -At -c "select coalesce(max(id), 0) from ops.backup_runs")"
  BACKUP_ENV=local DB_URL="$db_url" BACKUP_AGE_RECIPIENTS="$r1 $r2" AGE_BIN="$AGE" \
    BACKUP_S3_BUCKET="$TARGET_BUCKET_ST" BACKUP_S3_PREFIX="local/" BACKUP_S3_ENDPOINT="$s3_url" \
    BACKUP_S3_ACCESS_KEY_ID="$key_id" BACKUP_S3_SECRET_ACCESS_KEY="$secret" \
    STORAGE_S3_ENDPOINT="$s3_url" STORAGE_S3_REGION="$region" STORAGE_S3_KEY_ID="$key_id" STORAGE_S3_SECRET="$secret" \
    SUPABASE_WORKDIR="$ROOT" bash "$ROOT/ops/backup/backup.sh" > "$WORK/backup-run.log" 2>&1 || backup_rc=$?
  cat "$WORK/backup-run.log"
  # Exit 3 = uploaded, but the local runner is stale (dead-man): the archive is still valid for the drill.
  [[ $backup_rc -eq 0 || $backup_rc -eq 3 ]] || die "backup.sh failed (exit $backup_rc)"
  # 04-07c (M-BACKUPAUTH): the digest the backup recorded, from its own log (not from the bucket).
  local expected_sha
  expected_sha="$(sed -n 's/.*backup\.encrypted .*sha256=\([0-9a-f]\{64\}\).*/\1/p' "$WORK/backup-run.log" | tail -n 1)"
  [[ -n "$expected_sha" ]] || die "backup.sh did not report the archive digest"
  # ... and the same digest in its ops.backup_runs row (migration 000042; a record cross-check only: a real restore takes
  # the digest from the GitHub run, 04-07d N-2).
  local recorded_sha
  recorded_sha="$(PSQL_DB_URL="$db_url" PSQL_MOUNT="$WORK" "$BIN/psql-docker.sh" -X -At \
    -c "select archive_sha256 from ops.backup_runs where id > $before_id and status = 'ok' order by id desc limit 1")"
  [[ "$recorded_sha" == "$expected_sha" ]] || die "the ops.backup_runs row does not hold the archive digest the backup reported"

  local key
  key="$(s3 s3 ls "s3://$TARGET_BUCKET_ST/local/" | awk '{print $4}' | grep -E '\.tar\.age$' | sort | tail -n 1)"
  [[ -n "$key" ]] || die "no archive found in the stand-in bucket"
  s3 s3 cp "s3://$TARGET_BUCKET_ST/local/$key" "$WORK/archive.tar.age" --only-show-errors

  # Failed-run leg: a wrong Storage S3 secret fails the storage step; the run must exit non-zero and leave a `failed`
  # ops.backup_runs row with the machine code `storage_failed` (what the backup_stale alert and the report read).
  log "restore-drill.selftest failed-run leg (wrong Storage S3 secret)"
  local failed_rc=0 failed_row="" failed_recorded=false last_id
  last_id="$(PSQL_DB_URL="$db_url" PSQL_MOUNT="$WORK" "$BIN/psql-docker.sh" -X -At -c "select coalesce(max(id), 0) from ops.backup_runs")"
  BACKUP_ENV=local DB_URL="$db_url" BACKUP_AGE_RECIPIENTS="$r1 $r2" AGE_BIN="$AGE" \
    BACKUP_S3_BUCKET="$TARGET_BUCKET_ST" BACKUP_S3_PREFIX="local/" BACKUP_S3_ENDPOINT="$s3_url" \
    BACKUP_S3_ACCESS_KEY_ID="$key_id" BACKUP_S3_SECRET_ACCESS_KEY="$secret" \
    STORAGE_S3_ENDPOINT="$s3_url" STORAGE_S3_REGION="$region" STORAGE_S3_KEY_ID="$key_id" \
    STORAGE_S3_SECRET="wrong-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')" \
    SUPABASE_WORKDIR="$ROOT" bash "$ROOT/ops/backup/backup.sh" > "$WORK/failed-run.log" 2>&1 || failed_rc=$?
  failed_row="$(PSQL_DB_URL="$db_url" PSQL_MOUNT="$WORK" "$BIN/psql-docker.sh" -X -At -F '|' \
    -c "select status, error_code from ops.backup_runs where id > $last_id order by id desc limit 1")"
  if [[ $failed_rc -ne 0 && $failed_rc -ne 2 && "$failed_row" == "failed|storage_failed" ]] \
    && grep -q "backup.failed error_code=storage_failed" "$WORK/failed-run.log"; then
    failed_recorded=true
  fi
  log "restore-drill.selftest failed-run exit=$failed_rc recorded=$failed_recorded"

  # 04-07c (M-BACKUPAUTH): a tampered copy (one byte changed) is refused before decrypting; then the real archive is
  # checked against the recorded digest.
  local tampered_refused=false
  cp "$WORK/archive.tar.age" "$WORK/tampered.tar.age"
  node -e 'const fs = require("node:fs"); const b = fs.readFileSync(process.argv[1]); b[100] ^= 1; fs.writeFileSync(process.argv[1], b);' \
    "$WORK/tampered.tar.age"
  if ! (verify_digest "$WORK/tampered.tar.age" "$expected_sha") 2> /dev/null; then tampered_refused=true; fi
  rm -f "$WORK/tampered.tar.age"
  log "restore-drill.selftest tampered_archive_refused=$tampered_refused"
  verify_digest "$WORK/archive.tar.age" "$expected_sha"

  run_drill "$WORK/archive.tar.age" "$keys/primary.key"
  local breakglass=false
  decrypt_only "$WORK/archive.tar.age" "$keys/breakglass.key" && breakglass=true

  selftest_remove_buckets
  SELFTEST_BUCKETS=0
  rm -rf "$keys" "$WORK/archive.tar.age"

  local out="${EVIDENCE:-$WORK/restore-drill-selftest.json}"
  write_evidence "$out" self-test "$breakglass" "$failed_recorded" "$tampered_refused"
  if [[ -z "$EVIDENCE" ]]; then cat "$out"; fi
  log "restore-drill.selftest done"
}

case "$MODE" in
  decrypt-only)
    verify_digest "$DUMP" "$EXPECT_SHA"
    decrypt_only "$DUMP" "$IDENTITY" || die "the key did not open the archive"
    ;;
  archive)
    verify_digest "$DUMP" "$EXPECT_SHA"
    run_drill "$DUMP" "$IDENTITY"
    out="${EVIDENCE:-$WORK/restore-drill.json}"
    write_evidence "$out" archive
    if [[ -z "$EVIDENCE" ]]; then cat "$out"; fi
    ;;
  self-test)
    self_test
    ;;
esac
