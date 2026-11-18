#!/usr/bin/env bash
# Restore-drill psql steps (V2-04 04-07e, adversarial re-check N-2b). Sourced by ops/restore-drill/run.sh (and by
# tests/ops/drill-lib-db.spec.ts, which calls these functions against the local stack). Not executable on its own.
#
# Every psql session here runs through ops/bin/psql-restricted.sh: psql in restricted mode under a fresh key (it refuses
# every meta-command, whatever the SQL or a -v value holds), standard_conforming_strings on and client encoding UTF8
# whatever the restored roles or database say. Archive-derived values (manifest.json) are used only after
# ops/restore-drill/manifest-guard.ts validated them, and only as psql variables used quoted (`:'name'`) in fixed SQL
# files: never interpolated into SQL text here.
#
# Needs: ROOT (repository root), BIN (ops/bin), WORK (a directory psql-docker.sh mounts; the SQL files are copied
# there), DRILL_DB_URL (the target database URL; captured, never printed).

# shellcheck disable=SC2034 # read by the caller
DRILL_LIB_LOADED=1

json_get() { node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const v=process.argv[2].split(".").reduce((o,k)=>o?.[k],m);process.stdout.write(v===undefined?"":String(v))' "$1" "$2"; }

# psql against the drill target, restricted (04-07e: also the post-restore steps, not only the restore).
drill_psql() { PSQL_DB_URL="$DRILL_DB_URL" PSQL_MOUNT="$WORK" "$BIN/psql-restricted.sh" -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=terse "$@"; }

# A validated count from manifest-guard.ts's copy: digits only, else the step refuses (belt and braces: the guard
# already refused anything else).
drill_count_var() { # <validated manifest> <field>
  local v
  v="$(json_get "$1" "$2")"
  [[ "$v" =~ ^[0-9]{1,9}$ ]] || { echo "restore-drill: manifest field $2 is not a validated count" >&2; return 1; }
  printf '%s' "$v"
}

# Row counts of the manifest's tables in the restored database: `schema.table<TAB>count` lines to <out>.
drill_counts() { # <validated manifest> <out tsv>
  local tables
  tables="$(node -e '
const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const keys = Object.keys(m.tables).sort();
if (!keys.every((k) => /^[a-z_][a-z0-9_]{0,62}\.[a-z_][a-z0-9_]{0,62}$/.test(k))) process.exit(1);
process.stdout.write(JSON.stringify(keys));' "$1")" || { echo "restore-drill: manifest table keys are not validated" >&2; return 1; }
  cp "$ROOT/ops/restore-drill/counts.sql" "$WORK/counts.sql"
  drill_psql -At -F $'\t' -v tables="$tables" -f "$WORK/counts.sql" -o "$2"
}

# The pgTAP restore checks with the manifest's expected counts, then the generated authorisation matrix: TAP (and any
# error) to <out>.
drill_checks() { # <validated manifest> <out tap>
  local policies functions users
  policies="$(drill_count_var "$1" policies)" || return 1
  functions="$(drill_count_var "$1" functions)" || return 1
  users="$(drill_count_var "$1" auth_users)" || return 1
  cp "$ROOT/supabase/tests/restore_drill_checks.sql" "$WORK/restore_drill_checks.sql"
  drill_psql -At -v expected_policies="$policies" -v expected_functions="$functions" -v expected_users="$users" \
    -f "$WORK/restore_drill_checks.sql" > "$2" 2>&1 || return 1
  drill_authz_matrix "$2.authz" || { cat "$2.authz" >> "$2"; return 1; }
  cat "$2.authz" >> "$2"
}

# V2-05 05-01b (V2-04 ruling R-11 "V2-05 swaps in the matrix"): the generated role x table RLS matrix
# (supabase/tests/database/authz_matrix.test.sql, no meta-command) on the restored database, TAP to <out>. pgTAP is
# created inside the session's transaction, which the file's own `rollback` ends, so nothing persists. run.sh fails the
# drill on any `not ok` line.
drill_authz_matrix() { # <out tap>
  cp "$ROOT/supabase/tests/database/authz_matrix.test.sql" "$WORK/authz_matrix.test.sql"
  drill_psql -At -c "begin" -c "create extension if not exists pgtap with schema extensions" \
    -c "set local search_path = extensions, public" -f "$WORK/authz_matrix.test.sql" > "$1" 2>&1 || return 1
  ! grep -q '^not ok' "$1"
}
