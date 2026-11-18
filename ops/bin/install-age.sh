#!/usr/bin/env bash
# Installs the pinned age release (ops/bin/pins.env) for this host's OS/arch and verifies its SHA-256 before anything
# is unpacked (V2-04 04-05a, R-31; same pattern as scripts/ci/install-gitleaks.sh). A mismatch refuses and deletes the
# download. Used locally (restore drill, self-test), in the nightly backup-roundtrip job and in the staging backup workflow.
#
# Usage: ops/bin/install-age.sh [install-dir]   (default: $OPS_BIN_DIR or <repo>/.cache/ops-bin, git-ignored)
# Prints the directory holding `age` and `age-keygen` on the last line. Idempotent: a verified install is reused.
set -euo pipefail
umask 077

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=pins.env
source "$HERE/pins.env"

DEST="${1:-${OPS_BIN_DIR:-$HERE/../../.cache/ops-bin}}"

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) echo "install-age: unsupported OS $(uname -s)" >&2; exit 2 ;;
esac
case "$(uname -m)" in
  arm64 | aarch64) arch=arm64 ;;
  x86_64 | amd64) arch=amd64 ;;
  *) echo "install-age: unsupported architecture $(uname -m)" >&2; exit 2 ;;
esac

pin_var="AGE_SHA256_$(printf '%s_%s' "$os" "$arch" | tr '[:lower:]' '[:upper:]')"
want="${!pin_var:-}"
if [[ ! "$want" =~ ^[0-9a-f]{64}$ ]]; then
  echo "install-age: no SHA-256 pin for ${os}-${arch} in pins.env" >&2
  exit 2
fi

sha256_of() {
  if command -v sha256sum > /dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

mkdir -p "$DEST"
DEST="$(cd "$DEST" && pwd)"
marker="$DEST/.age-${AGE_VERSION}-${want}"
if [[ -f "$marker" && -x "$DEST/age" && -x "$DEST/age-keygen" ]]; then
  "$DEST/age" --version > /dev/null
  echo "$DEST"
  exit 0
fi

asset="age-v${AGE_VERSION}-${os}-${arch}.tar.gz"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 -o "$tmp/$asset" \
  "https://github.com/FiloSottile/age/releases/download/v${AGE_VERSION}/${asset}"
got="$(sha256_of "$tmp/$asset")"
if [[ "$got" != "$want" ]]; then
  echo "install-age: SHA-256 mismatch for $asset (refused; nothing installed)" >&2
  exit 1
fi

tar -xzf "$tmp/$asset" -C "$tmp" age/age age/age-keygen
install -m 0755 "$tmp/age/age" "$DEST/age"
install -m 0755 "$tmp/age/age-keygen" "$DEST/age-keygen"
rm -f "$DEST"/.age-*
: > "$marker"
version="$("$DEST/age" --version)"
echo "install-age: age ${version} (${os}-${arch}, sha256 verified)" >&2
echo "$DEST"
