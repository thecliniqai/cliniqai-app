#!/usr/bin/env bash
# psql in restricted mode (V2-04 04-07d, re-verification N-2; every ops/** psql session since 04-07e, N-2b):
# ops/bin/psql-docker.sh, but the session's first action is `\restrict <key>` with a fresh random key, so psql refuses
# every backslash meta-command (`\!`, `\o`, `\copy`, `\connect`, `\set`, `\gset`, …) for the whole session, whatever
# the SQL or the -v variable values that follow (psql re-lexes an interpolated `:var`, so a backslash in a value would
# otherwise start a meta-command). Only `\unrestrict <key>` would lift it, and the key is generated here at run time
# from /dev/urandom and never printed.
#
# 04-07e (N-2b): the session also runs with standard_conforming_strings on and client encoding UTF8, the two settings
# psql's own lexer depends on, whatever a restored role or database setting says:
#   - PGCLIENTENCODING=UTF8 (a libpq startup parameter, honoured by every server and pooler);
#   - an explicit `SET standard_conforming_strings = on` and `SET client_encoding = 'UTF8'` right after `\restrict`,
#     before any of the caller's SQL (a session-level SET overrides `ALTER ROLE|DATABASE … SET` values);
#   - on a loopback target (the local and drill stacks) also PGOPTIONS='-c standard_conforming_strings=on', so the
#     session starts with it. It is not sent to a remote host: Supabase's poolers are not known to pass startup options
#     through, and the explicit SET above already covers the session there.
# The session is always quiet (-q): command tags are never printed (the SETs above would otherwise print "SET").
#
# Feed the restore the guard's restore copies (`sql-guard.ts --emit-dir`): pg_dump's own `\restrict` / `\unrestrict`
# lines are comments there, since psql refuses a second `\restrict` in restricted mode. Files and SQL run from
# ops/**: none of them may use a meta-command; psql variables go in with -v and are used quoted (`:'name'`).
#
# Usage: PSQL_DB_URL=<url> [PSQL_MOUNT=<dir>] ops/bin/psql-restricted.sh [psql args...]
#   Same environment and arguments as psql-docker.sh, with at least one -c/-f (use `-f -` for stdin: with any -c psql
#   reads no stdin otherwise, and this wrapper always adds -c). Pass -X and -v ON_ERROR_STOP=1: a refused meta-command
#   is then an error that stops the script (exit 3) and, with --single-transaction, rolls it back.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

has_input=0
for a in "$@"; do
  case "$a" in
    -c | -f | --command=* | --file=*) has_input=1 ;;
    --*) ;;
    -[A-Za-z]*[cf]) has_input=1 ;;
  esac
done
if [[ $has_input -eq 0 ]]; then
  echo "psql-restricted: pass the SQL with -c or -f (use -f - for stdin)" >&2
  exit 2
fi

key="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
[[ "$key" =~ ^[0-9a-f]{48}$ ]] || { echo "psql-restricted: could not generate a key" >&2; exit 2; }

export PGCLIENTENCODING=UTF8
unset PGOPTIONS
url_host="${PSQL_DB_URL:-}"
url_host="${url_host#*://}"
url_host="${url_host#*@}"
url_host="${url_host%%/*}"
url_host="${url_host%%\?*}"
case "$url_host" in
  127.0.0.1 | 127.0.0.1:* | localhost | localhost:* | "[::1]" | "[::1]:"* | host.docker.internal | host.docker.internal:*)
    export PGOPTIONS="-c standard_conforming_strings=on"
    ;;
esac

exec "$HERE/psql-docker.sh" -q -c "\\restrict $key" \
  -c "SET standard_conforming_strings = on" -c "SET client_encoding = 'UTF8'" "$@"
