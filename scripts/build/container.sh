#!/usr/bin/env bash
# Runs scripts/build/build.ts inside the pinned build image, so the host only needs Docker.
#
#   scripts/build/container.sh [--platform linux/amd64|linux/arm64] [build.ts arguments]
#
# --platform linux/arm64 on an x86-64 host builds under QEMU emulation (slow, but it
# produces and smoke-tests real ARM64 binaries). The repository is mounted read-only;
# only build/ is writable. The container has no network access while building.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
platform=""
if [ "${1:-}" = "--platform" ]; then
  platform="${2:?--platform needs a value such as linux/arm64}"
  shift 2
fi

out="${DEVMOTER_BASE_BUILD_DIR:-$root/build}"
mkdir -p "$out"
tag="devmoter-base-build:${platform##*/}"
[ -n "$platform" ] || tag="devmoter-base-build:native"

docker build ${platform:+--platform "$platform"} -t "$tag" "$root/scripts/build"
exec docker run --rm ${platform:+--platform "$platform"} \
  --network none \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e DEVMOTER_BASE_BUILD_DIR=/out \
  -v "$root":/repo:ro \
  -v "$out":/out \
  "$tag" "$@"
