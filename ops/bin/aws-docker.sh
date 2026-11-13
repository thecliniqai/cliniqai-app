#!/usr/bin/env bash
# AWS CLI v2 from the digest-pinned amazon/aws-cli image (ops/bin/pins.env; R-31). V2-04 04-05a.
#
# Used for every S3 call of the backup: the source project's Supabase Storage S3 endpoint, the target bucket (Cloudflare
# R2 for staging; the local Storage S3 endpoint as the stand-in locally) and the restore-drill self-test. A loopback
# `--endpoint-url http://127.0.0.1:…` is rewritten to host.docker.internal (host-gateway mapping, also on Linux runners). Only these AWS variables cross into the container, by name (values
# never appear in argv): AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN, AWS_REGION, AWS_DEFAULT_REGION,
# AWS_REQUEST_CHECKSUM_CALCULATION, AWS_RESPONSE_CHECKSUM_VALIDATION. Instance metadata is disabled and path-style
# addressing is forced (S3-compatible endpoints).
#
# Usage: ops/bin/aws-docker.sh <aws args...>   files must live under $AWS_DOCKER_MOUNT (default: the current directory),
# which is mounted at the same path. Runs as the calling user.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=pins.env
source "$HERE/pins.env"

args=()
for a in "$@"; do
  a="${a/:\/\/127.0.0.1/://host.docker.internal}"
  a="${a/:\/\/localhost/://host.docker.internal}"
  a="${a/:\/\/\[::1\]/://host.docker.internal}"
  args+=("$a")
done

MOUNT="$(cd "${AWS_DOCKER_MOUNT:-$PWD}" && pwd)"
cfg="$(mktemp -d)"
trap 'rm -rf "$cfg"' EXIT
printf '[default]\ns3 =\n    addressing_style = path\n' > "$cfg/config"
chmod 0755 "$cfg"
chmod 0644 "$cfg/config"

pass=()
for name in AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_REGION AWS_DEFAULT_REGION \
  AWS_REQUEST_CHECKSUM_CALCULATION AWS_RESPONSE_CHECKSUM_VALIDATION; do
  [[ -n "${!name:-}" ]] && pass+=(-e "$name")
done

docker run --rm -i \
  --add-host=host.docker.internal:host-gateway \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp -e AWS_EC2_METADATA_DISABLED=true -e AWS_CONFIG_FILE=/aws-cfg/config -e AWS_PAGER= \
  ${pass[@]+"${pass[@]}"} \
  -v "$cfg:/aws-cfg:ro" -v "$MOUNT:$MOUNT" -w "$PWD" \
  "$AWS_CLI_IMAGE" ${args[@]+"${args[@]}"}
