#!/usr/bin/env bash
# Installs the pinned gitleaks release binary for the CI `security` job (V2-02 plan 02-01 step 6, ruling RL-9).
# No gitleaks-action (it needs a licence secret on organisation repos) and no secrets of any kind.
#
# The tarball is verified against a SHA-256 pinned here AND against the release's checksums file, so a swapped
# release asset fails either way. To upgrade: pick a release at least two weeks old, read the new digest from
# `gh api repos/gitleaks/gitleaks/releases/tags/<tag>` (assets[].digest) or the checksums file, update both values
# below in one reviewed PR.
#
# Usage: scripts/ci/install-gitleaks.sh [install-dir]   (default: $RUNNER_TEMP/gitleaks or ./.gitleaks-bin)
# Prints the installed binary path on the last line.
set -euo pipefail

VERSION="8.30.1"
ASSET="gitleaks_${VERSION}_linux_x64.tar.gz"
ASSET_SHA256="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"
CHECKSUMS_SHA256="061476c21adaf5441516f96f185c1a4706a83cd6329b9b38762271b3d4a52fae"
BASE="https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}"

if [[ "$(uname -s)" != "Linux" || "$(uname -m)" != "x86_64" ]]; then
  echo "install-gitleaks: this script installs the linux_x64 build only (CI runner). Locally, use the pinned" >&2
  echo "release for your platform and verify it against ${BASE}/gitleaks_${VERSION}_checksums.txt" >&2
  exit 2
fi

DEST="${1:-${RUNNER_TEMP:-$PWD}/gitleaks-bin}"
mkdir -p "$DEST"
cd "$DEST"

curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 -o "$ASSET" "${BASE}/${ASSET}"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 -o checksums.txt \
  "${BASE}/gitleaks_${VERSION}_checksums.txt"

echo "${CHECKSUMS_SHA256}  checksums.txt" | sha256sum --check --strict
echo "${ASSET_SHA256}  ${ASSET}" | sha256sum --check --strict
grep -E "^${ASSET_SHA256}  ${ASSET}\$" checksums.txt > /dev/null || {
  echo "install-gitleaks: pinned digest not found in the release checksums file" >&2
  exit 1
}

tar -xzf "$ASSET" gitleaks
chmod +x gitleaks
./gitleaks version
echo "$DEST/gitleaks"
