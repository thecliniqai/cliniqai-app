#!/usr/bin/env bash
# Installs the pinned OSV-Scanner release binary for the CI `security` job (V2-14 14-02, SVP §3; T-14-01).
# No action, no token, no upload: the scanner only queries the public OSV API with package names and versions from
# package-lock.json (no repository content leaves the runner).
#
# The binary is verified against a SHA-256 pinned here AND against the release's SHA256SUMS file (itself pinned), so a
# swapped release asset fails either way. To upgrade: pick a release at least two weeks old, read the digests from
# `gh api repos/google/osv-scanner/releases/tags/<tag>` (assets[].digest), update all three values in one reviewed PR.
#
# Usage: scripts/ci/install-osv.sh [install-dir]   (default: $RUNNER_TEMP/osv-bin or ./osv-bin)
# Prints the installed binary path on the last line.
set -euo pipefail

VERSION="2.7.1"
ASSET="osv-scanner_linux_amd64"
ASSET_SHA256="fb7dab19a8bd9bbe5c3189f09d4b7ee1820c9553a23bac202648a56efd2f6ee8"
SUMS_SHA256="f7d6b86d974ad856e2e944e3556d58033d76b7bb7126c76731129f1f1a12fd89"
BASE="https://github.com/google/osv-scanner/releases/download/v${VERSION}"

if [[ "$(uname -s)" != "Linux" || "$(uname -m)" != "x86_64" ]]; then
  echo "install-osv: this script installs the linux_amd64 build only (CI runner)." >&2
  exit 2
fi

DEST="${1:-${RUNNER_TEMP:-$PWD}/osv-bin}"
mkdir -p "$DEST"
cd "$DEST"

curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 -o "$ASSET" "${BASE}/${ASSET}"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 -o SHA256SUMS "${BASE}/osv-scanner_SHA256SUMS"

echo "${SUMS_SHA256}  SHA256SUMS" | sha256sum --check --strict
echo "${ASSET_SHA256}  ${ASSET}" | sha256sum --check --strict
grep -E "^${ASSET_SHA256}  ${ASSET}\$" SHA256SUMS > /dev/null || {
  echo "install-osv: pinned digest not found in the release SHA256SUMS file" >&2
  exit 1
}

mv "$ASSET" osv-scanner
chmod +x osv-scanner
./osv-scanner --version
echo "$DEST/osv-scanner"
