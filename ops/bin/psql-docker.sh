#!/usr/bin/env bash
# psql 17 from the digest-pinned postgres image (ops/bin/pins.env; host psql is 14, research pitfall 12). V2-04 04-05a.
#
# The connection URL comes from the environment variable PSQL_DB_URL, never from argv: the docker command line carries
# only the variable's name, and the URL reaches psql inside the container, so it never shows in `ps` or a log. A
# loopback host (127.0.0.1, localhost, [::1]) is rewritten to host.docker.internal so the container reaches a local
# Supabase stack on the host (mapped with host-gateway, which also works on Linux runners).
#
# Usage: PSQL_DB_URL=<url> [PGPASSWORD=…] [PGSSLMODE=…] ops/bin/psql-docker.sh [psql args...]
#   ops/** never calls this directly (04-07e, N-2b): every session goes through ops/bin/psql-restricted.sh.
#   stdin is passed through; files named in the args must live under $PSQL_MOUNT (default: the current directory),
#   which is mounted at the same path. Runs as the calling user.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=pins.env
source "$HERE/pins.env"

if [[ -z "${PSQL_DB_URL:-}" ]]; then
  echo "psql-docker: PSQL_DB_URL is not set" >&2
  exit 2
fi

loopback_to_docker_host() {
  local url="$1"
  url="${url/@127.0.0.1:/@host.docker.internal:}"
  url="${url/@127.0.0.1\//@host.docker.internal/}"
  url="${url/@localhost:/@host.docker.internal:}"
  url="${url/@localhost\//@host.docker.internal/}"
  url="${url/@\[::1\]:/@host.docker.internal:}"
  url="${url/:\/\/127.0.0.1/://host.docker.internal}"
  url="${url/:\/\/localhost/://host.docker.internal}"
  printf '%s' "$url"
}

PSQL_DB_URL="$(loopback_to_docker_host "$PSQL_DB_URL")"
export PSQL_DB_URL

MOUNT="$(cd "${PSQL_MOUNT:-$PWD}" && pwd)"
tty_flag=()
[[ -t 0 && -t 1 ]] && tty_flag=(-t)
# A password-free URL (target-guard --no-password) takes its password from PGPASSWORD; both cross by name only.
# PGCLIENTENCODING / PGOPTIONS: set by psql-restricted.sh (04-07e, N-2b), also by name.
pass=()
for name in PGPASSWORD PGSSLMODE PGCLIENTENCODING PGOPTIONS; do
  [[ -n "${!name:-}" ]] && pass+=(-e "$name")
done

exec docker run --rm -i ${tty_flag[@]+"${tty_flag[@]}"} \
  --add-host=host.docker.internal:host-gateway \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp -e PSQL_DB_URL -e PGCONNECT_TIMEOUT=15 ${pass[@]+"${pass[@]}"} \
  -v "$MOUNT:$MOUNT" -w "$PWD" \
  --entrypoint sh \
  "$POSTGRES_IMAGE" \
  -c 'exec psql "$PSQL_DB_URL" "$@"' psql "$@"
