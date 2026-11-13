#!/usr/bin/env bash
# psql in restricted mode (V2-04 04-07d, re-verification N-2): ops/bin/psql-docker.sh, but the session's first action
# is `\restrict <key>` with a fresh random key, so psql refuses every backslash meta-command (`\!`, `\o`, `\copy`,
# `\connect`, `\set`, …) for the whole session, whatever the SQL that follows. Only `\unrestrict <key>` would lift it,
# and the key is generated here at run time from /dev/urandom, after the archive was written, and never printed.
#
# This is the restore's runtime guarantee behind ops/restore-drill/sql-guard.ts: even where psql's lexer and the guard's
# part (a client_encoding switched by server-side code, a setting no text scan can see), psql executes no meta-command.
# Feed it the guard's restore copies (`sql-guard.ts --emit-dir`): pg_dump's own `\restrict` / `\unrestrict` lines are
# comments there, since psql refuses a second `\restrict` in restricted mode.
#
# Usage: PSQL_DB_URL=<url> [PSQL_MOUNT=<dir>] ops/bin/psql-restricted.sh [psql args...]
#   Same environment and arguments as psql-docker.sh. Pass -X and -v ON_ERROR_STOP=1 as the restore does: a refused
#   meta-command is then an error that stops the script (exit 3) and, with --single-transaction, rolls it back.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

key="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
[[ "$key" =~ ^[0-9a-f]{48}$ ]] || { echo "psql-restricted: could not generate a key" >&2; exit 2; }

exec "$HERE/psql-docker.sh" -c "\\restrict $key" "$@"
