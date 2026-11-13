#!/usr/bin/env sh
# Lockfile check for Linux CI (V2-03 03-03; root cause of PR #5's `npm ci` failure at 3f72aa5).
#
# A lockfile written by npm on macOS can omit optional entries that npm on Linux requires (there:
# `@emnapi/core` and `@emnapi/runtime` 1.11.3 under `@tailwindcss/oxide-wasm32-wasi`), so `npm ci` fails in every CI
# job with "Missing: ... from lock file". CI uses `.nvmrc` (Node 24) and its bundled npm on ubuntu; this script runs
# the same npm in the `node:24` container.
#
# Usage (repo root, Docker running):
#   scripts/ci/lock-linux-check.sh          check: `npm ci --dry-run` against the committed package.json and lock,
#                                           both mounted read-only (nothing in the checkout changes)
#   scripts/ci/lock-linux-check.sh --fix    rewrite package-lock.json with Linux npm (`npm install
#                                           --package-lock-only`), then run the check; review the lock diff and
#                                           commit it on its own
# Run it after any package.json / package-lock.json change made with a local npm. `--ignore-scripts` everywhere:
# no install script runs. Not wired into CI: CI's own `npm ci` is the check there.
set -eu
cd "$(git rev-parse --show-toplevel)"
IMAGE="node:24"

if [ "${1:-}" = "--fix" ]; then
  docker run --rm -v "$PWD":/w -w /w "$IMAGE" sh -c 'npm install --package-lock-only --ignore-scripts --no-audit --no-fund'
fi

docker run --rm \
  -v "$PWD/package.json":/w/package.json:ro \
  -v "$PWD/package-lock.json":/w/package-lock.json:ro \
  -w /w "$IMAGE" sh -c 'echo "npm $(npm --version) on $(uname -s)"; npm ci --ignore-scripts --dry-run --no-audit --no-fund'
echo "lock-linux-check: PASS (npm ci accepts the lockfile on Linux)"
