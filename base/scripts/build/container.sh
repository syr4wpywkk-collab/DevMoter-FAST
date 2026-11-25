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
# Docker reads a relative path as the name of a volume, not as a directory.
out=$(cd "$out" && pwd)

# The build reads the pinned trees from git, so the whole repository is mounted (DevMoter Base
# may live in a subdirectory of it, such as base/ in DevMoter FAST) and the build runs from the DevMoter Base directory inside it.
# In a linked worktree .git is a file that points into the main checkout, where the objects are,
# so that directory is mounted too, at the path the file names.
top=$(git -C "$root" rev-parse --show-toplevel)
prefix=$(git -C "$root" rev-parse --show-prefix)
mounts=()
common=$(git -C "$root" rev-parse --path-format=absolute --git-common-dir)
[ "$common" = "$top/.git" ] || mounts+=(-v "$common":"$common":ro)
tag="devmoter-base-build:${platform##*/}"
[ -n "$platform" ] || tag="devmoter-base-build:native"

docker build ${platform:+--platform "$platform"} --build-arg DMB_UID="$(id -u)" -t "$tag" "$root/scripts/build"
exec docker run --rm ${platform:+--platform "$platform"} \
  --network none \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e DEVMOTER_BASE_BUILD_DIR=/out \
  -v "$top":/repo:ro \
  -w "/repo/${prefix%/}" \
  -v "$out":/out \
  ${mounts[@]+"${mounts[@]}"} \
  "$tag" "$@"
